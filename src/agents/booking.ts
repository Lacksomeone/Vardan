import db from '../db.js';
import { sendTextMessage } from '../whatsapp.js';
import { LLMGateway } from '../llm.js';
import { syncAppointmentToGoogleSheet } from '../sheets.js';

interface BookingSession {
  stage: 'doctor_or_symptom' | 'date' | 'slot' | 'confirm';
  doctorId?: number;
  date?: string; // YYYY-MM-DD
  timeSlot?: string;
  action: 'book' | 'cancel' | 'reschedule';
  appointmentIdToModify?: number;
  patientRelation?: string;
}

const bookingSessions: Record<string, BookingSession> = {};

export function hasActiveBookingSession(patientId: string): boolean {
  return !!bookingSessions[patientId];
}

export function clearBookingSession(patientId: string) {
  if (bookingSessions[patientId]) {
    delete bookingSessions[patientId];
    return true;
  }
  return false;
}

// Helper: Convert time windows ("10:00-14:00") into 30-min slots
function parseWindowToSlots(window: string): string[] {
  const [start, end] = window.split('-');
  const [startH, startM] = start.split(':').map(Number);
  const [endH, endM] = end.split(':').map(Number);
  
  const slots: string[] = [];
  let currMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;
  
  while (currMin + 30 <= endMin) {
    const h1 = Math.floor(currMin / 60).toString().padStart(2, '0');
    const m1 = (currMin % 60).toString().padStart(2, '0');
    const nextMin = currMin + 30;
    const h2 = Math.floor(nextMin / 60).toString().padStart(2, '0');
    const m2 = (nextMin % 60).toString().padStart(2, '0');
    
    slots.push(`${h1}:${m1}-${h2}:${m2}`);
    currMin = nextMin;
  }
  return slots;
}

// Get day name from date string in UTC to avoid timezone shifts
function getDayName(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return days[date.getUTCDay()];
}

// Fetch available slots for a doctor on a given date
function getAvailableSlots(doctorId: number, dateStr: string): string[] {
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(doctorId) as any;
  if (!doctor || !doctor.active) return [];

  const dayName = getDayName(dateStr);
  const schedule = JSON.parse(doctor.weekly_schedule_json);
  const dayWindows = schedule[dayName] as string[];
  
  if (!dayWindows || dayWindows.length === 0) return [];

  // Generate all possible slots
  let allSlots: string[] = [];
  for (const window of dayWindows) {
    allSlots = allSlots.concat(parseWindowToSlots(window));
  }

  // Get currently booked slots
  const booked = db.prepare(`
    SELECT time_slot FROM appointments 
    WHERE doctor_id = ? AND date = ? AND status IN ('pending', 'confirmed', 'rescheduled')
  `).all(doctorId, dateStr) as { time_slot: string }[];

  const bookedSlots = booked.map(b => b.time_slot);

  // Return slots that are not booked
  return allSlots.filter(slot => !bookedSlots.includes(slot));
}

function parseDateLocally(text: string): string | null {
  const clean = text.trim().toLowerCase();
  const today = new Date();

  // 1. "today" / "aaj" / "now"
  if (clean === 'today' || clean === 'aaj' || clean === 'aaj hi' || clean === 'now') {
    return today.toISOString().split('T')[0];
  }

  // 2. "tomorrow" / "kal"
  if (clean === 'tomorrow' || clean === 'kal' || clean === 'kal ka') {
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }

  // 3. "day after tomorrow" / "parso"
  if (clean === 'day after tomorrow' || clean === 'parso' || clean === 'parson') {
    const parso = new Date(today);
    parso.setDate(today.getDate() + 2);
    return parso.toISOString().split('T')[0];
  }

  // 4. Weekdays: "monday", "tuesday", etc.
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = weekdays.indexOf(clean);
  if (dayIndex !== -1) {
    const nextDay = new Date(today);
    const currentDayIndex = today.getDay();
    let diff = dayIndex - currentDayIndex;
    if (diff <= 0) diff += 7;
    nextDay.setDate(today.getDate() + diff);
    return nextDay.toISOString().split('T')[0];
  }

  // 5. Month name: e.g. "11 july", "13 July 2026", "July 13"
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthsShort = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  const numMatch = clean.match(/\d+/);
  if (numMatch) {
    const dayNum = parseInt(numMatch[0], 10);
    if (dayNum >= 1 && dayNum <= 31) {
      let foundMonthIndex = -1;
      for (let i = 0; i < 12; i++) {
        if (clean.includes(months[i]) || clean.includes(monthsShort[i])) {
          foundMonthIndex = i;
          break;
        }
      }
      if (foundMonthIndex !== -1) {
        const yearMatch = clean.match(/\b(202\d)\b/);
        const yearNum = yearMatch ? parseInt(yearMatch[1], 10) : today.getFullYear();
        const dateObj = new Date(Date.UTC(yearNum, foundMonthIndex, dayNum));
        return dateObj.toISOString().split('T')[0];
      }
    }
  }

  // 0. ISO/Standard format: e.g. "2026-07-13"
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      return dateObj.toISOString().split('T')[0];
    }
  }

  // 6. Numeric formats: e.g. "13-07-2026", "13/07/26", "13.07", "13-7" (anchored to avoid partial match in YYYY-MM-DD)
  const datePartsMatch = clean.match(/^(\d{1,2})[-/.](\d{1,2})([-/.](\d{2,4}))?$/);
  if (datePartsMatch) {
    const d = parseInt(datePartsMatch[1], 10);
    const m = parseInt(datePartsMatch[2], 10);
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      let y = today.getFullYear();
      if (datePartsMatch[4]) {
        const yearStr = datePartsMatch[4];
        y = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
      }
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      return dateObj.toISOString().split('T')[0];
    }
  }

  return null;
}

// Parse date text (e.g. "tomorrow", "12 July", "Monday") into YYYY-MM-DD
async function parseDateWithLLM(text: string): Promise<string | null> {
  // First-line defense: try parsing locally for fast and robust match
  const localMatch = parseDateLocally(text);
  if (localMatch) {
    console.log(`[DateParser] parsed "${text}" locally -> ${localMatch}`);
    return localMatch;
  }

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const localDateStr = today.toLocaleDateString('en-US', options);
  
  const systemPrompt = `You are a scheduling assistant. Extract the date mentioned by the user relative to TODAY.
TODAY's date is: ${todayStr} (local time is ${localDateStr}).
Extract the date in YYYY-MM-DD format.
If the date is ambiguous or not specified, return {"date": null}.
If it refers to a weekday (e.g., "Monday"), find the next occurrence of that weekday.

Format output as strict JSON:
{"date": "YYYY-MM-DD" | null}`;

  const llmGateway = LLMGateway.getInstance();
  try {
    const resultStr = await llmGateway.getChatCompletion('groq', {
      systemPrompt,
      userPrompt: text,
      responseFormatJson: true
    });
    const parsed = JSON.parse(resultStr) as { date: string | null };
    return parsed.date;
  } catch (err) {
    console.error('Date parsing failed:', err);
    return null;
  }
}

export async function handleBookingQuery(patientId: string, text: string, lang: 'hi' | 'en' | 'hinglish') {
  let session = bookingSessions[patientId];

  // 1. Initial Booking Command / Cancellation Request
  if (!session) {
    const textLower = text.toLowerCase();
    
    // Check if user wants to cancel
    if (textLower.includes('cancel') || textLower.includes('radd') || textLower.includes('khatam') || textLower.includes('cancle')) {
      const activeAppt = db.prepare(`
        SELECT a.*, d.name as doctor_name FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = ? AND a.status IN ('pending', 'confirmed')
        ORDER BY a.date ASC LIMIT 1
      `).get(patientId) as any;

      if (!activeAppt) {
        const noApptMsgs = {
          hi: 'आपका कोई सक्रिय अपॉइंटमेंट नहीं मिला जिसे कैंसिल किया जा सके।',
          hinglish: 'Aapka koi active appointment nahi mila jise cancel kiya ja sake.',
          en: 'We could not find any active appointments to cancel.'
        };
        await sendTextMessage(patientId, noApptMsgs[lang]);
        return;
      }

      bookingSessions[patientId] = {
        stage: 'confirm',
        action: 'cancel',
        appointmentIdToModify: activeAppt.id
      };

      const cancelConfirmMsgs = {
        hi: `क्या आप ${activeAppt.doctor_name} के साथ ${activeAppt.date} (${activeAppt.time_slot}) का अपॉइंटमेंट कैंसिल करना चाहते हैं? कृपया "हाँ" या "नहीं" लिखकर भेजें।`,
        hinglish: `Kya aap ${activeAppt.doctor_name} ke sath ${activeAppt.date} (${activeAppt.time_slot}) ka appointment cancel karna chahte hain? Kripya "Haan" ya "Nahi" likhein.`,
        en: `Do you want to cancel your appointment with ${activeAppt.doctor_name} on ${activeAppt.date} (${activeAppt.time_slot})? Please reply with "Yes" or "No".`
      };
      await sendTextMessage(patientId, cancelConfirmMsgs[lang]);
      return;
    }

    // Check if user wants to reschedule
    if (textLower.includes('reschedule') || textLower.includes('change') || textLower.includes('badal')) {
      const activeAppt = db.prepare(`
        SELECT a.*, d.name as doctor_name FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = ? AND a.status IN ('pending', 'confirmed')
        ORDER BY a.date ASC LIMIT 1
      `).get(patientId) as any;

      if (!activeAppt) {
        const noApptMsgs = {
          hi: 'आपका कोई सक्रिय अपॉइंटमेंट नहीं मिला जिसे बदला जा सके।',
          hinglish: 'Aapka koi active appointment nahi mila jise reschedule kiya ja sake.',
          en: 'We could not find any active appointments to reschedule.'
        };
        await sendTextMessage(patientId, noApptMsgs[lang]);
        return;
      }

      bookingSessions[patientId] = {
        stage: 'date', // Skip doctor selection and go directly to date selection
        action: 'reschedule',
        appointmentIdToModify: activeAppt.id,
        doctorId: activeAppt.doctor_id
      };

      const rescheduleMsgs = {
        hi: `आप अपना अपॉइंटमेंट बदलना चाहते हैं। कृपया नया दिन या तारीख लिखकर भेजें (उदाहरण: कल, या 13 July)।`,
        hinglish: `Aap apna appointment reschedule karna chahte hain. Kripya naya day ya date likhkar bhejein (e.g. kal, ya 13 July).`,
        en: `You want to reschedule your appointment. Please reply with the new date (e.g. tomorrow, or 13 July).`
      };
      await sendTextMessage(patientId, rescheduleMsgs[lang]);
      return;
    }

    // Default: Start booking flow (with pre-extraction)
    let preExtractedDocId: number | null = null;
    let preExtractedDate: string | null = null;
    let preExtractedRelation: string | null = null;

    try {
      const doctors = db.prepare('SELECT * FROM doctors WHERE active = 1').all() as any[];
      if (doctors.length > 0) {
        const docListStr = doctors.map(d => `${d.id}: Dr. ${d.name} (${d.department})`).join('\n');
        const systemPrompt = `You are a smart booking receptionist for Vardan Hospital.
We have the following doctors currently active:
${docListStr}

Analyze the patient's incoming booking request: "${text}"
And extract details:
1. "doctorId": Match to the best suited Doctor ID if they mention a doctor name or a matching symptom (e.g., child -> Pediatrics/Dr. Om Shukla, heart/chest -> Cardiology/Dr. Nitin Singh, fever/cough -> General Medicine/Dr. Ankit Sharma). Else set to null.
2. "date": The raw date string mentioned (e.g., "tomorrow", "kal", "15 July", "Monday") or null if not mentioned.
3. "relation": Who the appointment is for (e.g., "mother", "father", "son", "myself") or null.

Format your output as a strict JSON object matching this schema:
{
  "doctorId": number | null,
  "date": string | null,
  "relation": string | null
}`;

        const responseStr = await LLMGateway.getInstance().getChatCompletion('gemini', {
          systemPrompt,
          userPrompt: text,
          responseFormatJson: true
        });

        let cleaned = responseStr.trim();
        if (cleaned.includes('```')) {
          const match = cleaned.match(/```(?:json)?([\s\S]*?)```/);
          if (match && match[1]) {
            cleaned = match[1].trim();
          }
        }
        const parsed = JSON.parse(cleaned) as { doctorId: number | null; date: string | null; relation: string | null };
        if (parsed.doctorId) {
          preExtractedDocId = Number(parsed.doctorId);
        }
        if (parsed.date) {
          const resolved = await parseDateWithLLM(parsed.date);
          if (resolved) {
            preExtractedDate = resolved;
          }
        }
        if (parsed.relation) {
          preExtractedRelation = parsed.relation;
        }
      }
    } catch (err) {
      console.error('[Booking Pre-extraction] failed:', err);
    }

    bookingSessions[patientId] = {
      stage: 'doctor_or_symptom',
      action: 'book',
      doctorId: preExtractedDocId || undefined,
      date: preExtractedDate || undefined,
      patientRelation: preExtractedRelation || undefined
    };
    session = bookingSessions[patientId];

    // Now evaluate and dynamically route or prompt
    if (session.doctorId && session.date) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (session.date >= todayStr) {
        const slots = getAvailableSlots(session.doctorId, session.date);
        if (slots.length > 0) {
          session.stage = 'slot';
          const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(session.doctorId) as any;
          const slotList = slots.map((s, i) => `${i + 1}. ${s}`).join('\n');
          const relationStr = session.patientRelation ? ` (for your ${session.patientRelation})` : '';
          
          const slotPrompt = {
            hi: `✅ हमने आपके अनुरोध को समझ लिया है। आप **${doctor.name}** के साथ **${session.date}**${relationStr} का अपॉइंटमेंट बुक कर रहे हैं।\n\nउपलब्ध समय:\n${slotList}\n\nकृपया समय चुनें (जैसे: 10:00-10:30 या संख्या 1, 2 लिखें)।`,
            hinglish: `✅ Humne aapka request samajh liya hai. Aap **${doctor.name}** ke sath **${session.date}**${relationStr} ka appointment book kar rahe hain.\n\nAvailable slots:\n${slotList}\n\nKripya time slot select karein (e.g. 10:00-10:30 ya number 1, 2 likhein).`,
            en: `✅ We understood your request. Booking an appointment with **${doctor.name}** on **${session.date}**${relationStr}.\n\nAvailable slots:\n${slotList}\n\nPlease select a time slot (e.g. 10:00-10:30 or write number 1, 2).`
          };
          await sendTextMessage(patientId, slotPrompt[lang]);
          return;
        }
      }
    }

    if (session.doctorId && !session.date) {
      session.stage = 'date';
      const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(session.doctorId) as any;
      const datePrompt = {
        hi: `ठीक है, आप **${doctor.name}** के साथ अपॉइंटमेंट बुक करना चाहते हैं। कृपया दिनांक (तारीख या दिन) बताएं (जैसे: कल, या 13 July)।`,
        hinglish: `Okay, aap **${doctor.name}** ke sath appointment book karna chahte hain. Kripya date (tarikh ya day) batayein (e.g. kal, ya 13 July).`,
        en: `Okay, you want to book an appointment with **${doctor.name}**. Please specify the date (e.g., tomorrow, or 13 July).`
      };
      await sendTextMessage(patientId, datePrompt[lang]);
      return;
    }

    if (!session.doctorId && session.date) {
      session.stage = 'doctor_or_symptom';
      const docPrompt = {
        hi: `ठीक है, आप **${session.date}** के लिए अपॉइंटमेंट बुक करना चाहते हैं। कृपया डॉक्टर का नाम बताएं या अपनी बीमारी/लक्षण बताएं (जैसे: बुखार, सीने में दर्द)।`,
        hinglish: `Okay, aap **${session.date}** ke liye appointment book karna chahte hain. Kripya doctor ka naam batayein ya apni problem/symptom batayein (e.g. fever, chest pain).`,
        en: `Okay, you want to book an appointment on **${session.date}**. Please specify the doctor's name or describe your symptoms (e.g. fever, chest pain).`
      };
      await sendTextMessage(patientId, docPrompt[lang]);
      return;
    }

    // Default flow when neither doctor nor date is pre-extracted
    const promptMsgs = {
      hi: 'वरदान हॉस्पिटल में अपॉइंटमेंट बुक करने के लिए, कृपया डॉक्टर का नाम बताएं (जैसे Dr. Nitin Singh) या अपनी बीमारी/लक्षण बताएं (जैसे: सीने में दर्द, बुखार)।',
      hinglish: 'Vardan Hospital me appointment book karne ke liye, kripya doctor ka naam batayein (e.g. Dr. Nitin Singh) ya apni problem/symptom batayein (e.g. chest pain, fever).',
      en: 'To book an appointment, please specify the doctor name (e.g., Dr. Nitin Singh) or describe your symptom (e.g. chest pain, fever).'
    };
    await sendTextMessage(patientId, promptMsgs[lang]);
    return;
  }

  // 2. Process stage: doctor_or_symptom
  if (session.stage === 'doctor_or_symptom') {
    const doctors = db.prepare('SELECT * FROM doctors WHERE active = 1').all() as any[];
    let selectedDoc: any = null;

    // Check direct name match (handles partial matching like "Nitin" or "Ankit" or "Om")
    const lowerText = text.toLowerCase().replace('dr.', '').trim();
    for (const doc of doctors) {
      const docNameClean = doc.name.toLowerCase().replace('dr.', '').trim();
      if (docNameClean.includes(lowerText) || lowerText.includes(docNameClean)) {
        selectedDoc = doc;
        break;
      }
    }

    // Advanced LLM symptom/doctor matching
    if (!selectedDoc && doctors.length > 0) {
      try {
        const docListStr = doctors.map(d => `${d.id}: Dr. ${d.name} (${d.department})`).join('\n');
        const systemPrompt = `You are a medical appointment classification assistant for Vardan Hospital.
We have the following doctors currently active:
${docListStr}

Analyze the patient's incoming request: "${text}"
And match it to the best suited Doctor ID.
Guidelines:
- Cardiac issues, chest pain, heartbeat, high BP, heart disease -> Cardiology (Dr. Nitin Singh).
- Child health, kids, babies, newborn issues, pediatric -> Pediatrics (Dr. Om Shukla).
- General illnesses (fever, headache, body pain, cough, cold, epilepsy, stomach issues) or any other unspecified ailments -> General Medicine (Dr. Ankit Sharma).
- If the patient explicitly mentions a doctor's name, match to that doctor.

Format your output as a strict JSON object matching this schema:
{"doctorId": number | null}`;

        const responseStr = await LLMGateway.getInstance().getChatCompletion('gemini', {
          systemPrompt,
          userPrompt: text,
          responseFormatJson: true
        });

        const parsed = JSON.parse(responseStr) as { doctorId: number | null };
        if (parsed.doctorId) {
          const matched = doctors.find(d => d.id === parsed.doctorId);
          if (matched) {
            selectedDoc = matched;
            console.log(`[Doctor Matching] Match found by LLM: Dr. ${selectedDoc.name}`);
          }
        }
      } catch (err) {
        console.error('[Doctor Matching LLM] failed:', err);
      }
    }

    // Heuristics mapping fallback if LLM matching fails
    if (!selectedDoc && doctors.length > 0) {
      if (lowerText.includes('chest') || lowerText.includes('heart') || lowerText.includes('cardiac') || lowerText.includes('dil') || lowerText.includes('bp')) {
        selectedDoc = doctors.find(d => d.department === 'Cardiology');
      } else if (lowerText.includes('bacha') || lowerText.includes('child') || lowerText.includes('kid') || lowerText.includes('baby') || lowerText.includes('pediatric')) {
        selectedDoc = doctors.find(d => d.department === 'Pediatrics');
      } else {
        selectedDoc = doctors.find(d => d.department === 'General Medicine');
      }
    }

    if (!selectedDoc) {
      const docNotFound = {
        hi: 'क्षमा करें, हम आपके बताए लक्षण के लिए डॉक्टर नहीं चुन पाए। कृपया हमारे जनरल फिजिशियन Dr. Ankit Sharma के साथ बुक करें या डॉक्टर का नाम बताएं।',
        hinglish: 'Sorry, hum aapke symptoms ke according doctor match nahi kar paye. Kripya General Physician Dr. Ankit Sharma ke sath book karein ya doctor ka naam batayein.',
        en: 'Sorry, we could not find a matching doctor for your symptoms. Please specify a doctor name or select Dr. Ankit Sharma (General Medicine).'
      };
      await sendTextMessage(patientId, docNotFound[lang]);
      return;
    }

    session.doctorId = selectedDoc.id;
    session.stage = 'date';

    // Show all available days for this week so patient knows directly
    const doctor = selectedDoc;
    const schedule = JSON.parse(doctor.weekly_schedule_json);
    const availableDays = Object.entries(schedule)
      .filter(([, v]: any) => Array.isArray(v) && v.length > 0)
      .map(([day]) => day)
      .join(', ');

    const datePrompt = {
      hi: `${doctor.name} के लिए दिनांक (तारीख, महीना, वर्ष) बताएं (जैसे: 15 July या कल)।`,
      hinglish: `${doctor.name} ke liye date (tarikh, mahina, saal) batayein (example: 15 July ya kal).`,
      en: `Please specify the date (date, month, year) for ${doctor.name} (e.g., July 15 or tomorrow).`
    };
    await sendTextMessage(patientId, datePrompt[lang]);
    return;
  }

  // 3. Process stage: date — parse date AND immediately show slots
  if (session.stage === 'date') {
    const parsedDate = await parseDateWithLLM(text);
    if (!parsedDate) {
      const invalidDate = {
        hi: 'कृपया सही तारीख बताएं (जैसे: कल, सोमवार, या 13 July)।',
        hinglish: 'Kripya sahi date batayein (e.g. kal, Monday, ya 13 July).',
        en: 'Please specify a valid date (e.g., tomorrow, Monday, or July 13).'
      };
      await sendTextMessage(patientId, invalidDate[lang]);
      return;
    }

    const todayStr = new Date().toISOString().split('T')[0];
    if (parsedDate < todayStr) {
      const pastDate = {
        hi: 'पिछली तारीख नहीं चुन सकते। कृपया आने वाले समय की तारीख बताएं।',
        hinglish: 'Past date select nahi kar sakte. Future date batayein.',
        en: 'Cannot select a past date. Please select a future date.'
      };
      await sendTextMessage(patientId, pastDate[lang]);
      return;
    }



    const slots = getAvailableSlots(session.doctorId!, parsedDate);
    if (slots.length === 0) {
      const noSlots = {
        hi: `${parsedDate} को कोई स्लॉट उपलब्ध नहीं है। कृपया कोई अन्य तारीख बताएं।`,
        hinglish: `${parsedDate} ko koi slot available nahi hai. Koi aur date batayein.`,
        en: `No slots available on ${parsedDate}. Please try a different date.`
      };
      await sendTextMessage(patientId, noSlots[lang]);
      return;
    }

    // ✅ Date valid + slots available — immediately show slots so patient picks directly
    session.date = parsedDate;
    session.stage = 'slot';

    const slotList = slots.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const slotPrompt = {
      hi: `✅ *${parsedDate}* को उपलब्ध समय:\n\n${slotList}\n\nकृपया समय चुनें (जैसे: 10:00-10:30)`,
      hinglish: `✅ *${parsedDate}* ke liye available slots:\n\n${slotList}\n\nKripya slot select karein (e.g. 10:00-10:30)`,
      en: `✅ Available slots on *${parsedDate}*:\n\n${slotList}\n\nPlease select a time slot (e.g. 10:00-10:30)`
    };
    await sendTextMessage(patientId, slotPrompt[lang]);
    return;
  }

  // 4. Process stage: slot
  if (session.stage === 'slot') {
    const slots = getAvailableSlots(session.doctorId!, session.date!);
    
    let matchedSlot: string | undefined = undefined;
    const index = parseInt(text.trim(), 10);
    if (!isNaN(index) && index >= 1 && index <= slots.length) {
      matchedSlot = slots[index - 1];
    } else {
      matchedSlot = slots.find(s => text.trim().includes(s) || s.includes(text.trim()));
    }

    if (!matchedSlot) {
      const invalidSlot = {
        hi: `कृपया दिए गए स्लॉट में से ही कोई एक सही समय लिखें:\n\n${slots.join('\n')}`,
        hinglish: `Kripya list me se hi koi sahi slot time likhein:\n\n${slots.join('\n')}`,
        en: `Please select a valid slot from the list:\n\n${slots.join('\n')}`
      };
      await sendTextMessage(patientId, invalidSlot[lang]);
      return;
    }

    session.timeSlot = matchedSlot;

    // ✅ AUTO-BOOK: Skip confirmation, book immediately with race-condition check
    const doctorForBook = db.prepare('SELECT name, department FROM doctors WHERE id = ?').get(session.doctorId!) as any;
    try {
      // Manual transaction (node:sqlite DatabaseSync has no .transaction() method)
      db.exec('BEGIN TRANSACTION');
      try {
        const currentSlots = getAvailableSlots(session.doctorId!, session.date!);
        if (!currentSlots.includes(session.timeSlot!)) {
          throw new Error('SLOT_TAKEN');
        }

        // If rescheduling, cancel the old appointment first
        if (session.action === 'reschedule' && session.appointmentIdToModify) {
          db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(session.appointmentIdToModify);
        }

        db.prepare(`
          INSERT INTO appointments (patient_id, doctor_id, date, time_slot, status)
          VALUES (?, ?, ?, ?, 'confirmed')
        `).run(patientId, session.doctorId, session.date, session.timeSlot);
        db.exec('COMMIT');
      } catch (txErr) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw txErr;
      }

      const patientForBook = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(patientId) as any;

      // Sync to Google Sheets
      syncAppointmentToGoogleSheet({
        patientName: patientForBook.name,
        patientPhone: patientForBook.phone,
        doctorName: doctorForBook.name,
        date: session.date!,
        timeSlot: session.timeSlot!,
        status: session.action === 'reschedule' ? 'rescheduled' : 'confirmed'
      }).catch(err => console.error('Failed to sync appointment to Google Sheets:', err));

      const autoBookedMsg = session.action === 'reschedule' ? {
        hi: `✅ आपका अपॉइंटमेंट सफलतापूर्वक बदल दिया गया है। अब यह ${doctorForBook.name} के साथ ${session.date} को ${session.timeSlot} बजे है।`,
        hinglish: `✅ Aapka appointment successfully change ho gaya hai. Ab yeh ${doctorForBook.name} ke sath ${session.date} ko ${session.timeSlot} baje hai.`,
        en: `✅ Your appointment has been successfully rescheduled. It is now with ${doctorForBook.name} on ${session.date} at ${session.timeSlot}.`
      } : {
        hi: `✅ आपका अपॉइंटमेंट ${doctorForBook.name} (${doctorForBook.department}) के साथ ${session.date} को ${session.timeSlot} बजे बुक हो गया है! कृपया समय पर अस्पताल पहुंचें।`,
        hinglish: `✅ Aapka appointment ${doctorForBook.name} (${doctorForBook.department}) ke sath ${session.date} ko ${session.timeSlot} par book ho gaya hai! Kripya time par hospital pahuchein.`,
        en: `✅ Your appointment with ${doctorForBook.name} (${doctorForBook.department}) on ${session.date} at ${session.timeSlot} has been booked! Please arrive on time.`
      };
      await sendTextMessage(patientId, autoBookedMsg[lang]);
    } catch (err: any) {
      if (err.message === 'SLOT_TAKEN') {
        const takenMsg = {
          hi: `क्षमा करें, ${session.timeSlot} का स्लॉट अभी भर गया है। कृपया कोई और समय चुनें:\n\n${getAvailableSlots(session.doctorId!, session.date!).join('\n')}`,
          hinglish: `Sorry, ${session.timeSlot} slot abhi kisi aur ne book kar liya. Koi aur slot chunein:\n\n${getAvailableSlots(session.doctorId!, session.date!).join('\n')}`,
          en: `Sorry, the ${session.timeSlot} slot was just taken. Please pick another:\n\n${getAvailableSlots(session.doctorId!, session.date!).join('\n')}`
        };
        session.stage = 'slot'; // Stay on slot selection
        await sendTextMessage(patientId, takenMsg[lang]);
        return;
      } else {
        console.error('Auto-booking transaction failed:', err);
        await sendTextMessage(patientId, 'Booking error occurred. Please try again.');
      }
    }
    delete bookingSessions[patientId];
    return;
  }

  // 5. Process stage: confirm (only for cancel / reschedule — book is auto-handled at slot selection)
  if (session.stage === 'confirm') {
    const answer = text.toLowerCase().trim();
    const isYes = answer === 'yes' || answer === 'y' || answer === 'ha' || answer === 'haan' || answer === 'ok' || answer === 'yes' || isHindiYes(answer);
    
    if (isYes) {
      if (session.action === 'book') {
        // Enforce race-condition double-check inside transaction
        try {
          // Manual transaction (node:sqlite DatabaseSync has no .transaction() method)
          db.exec('BEGIN TRANSACTION');
          try {
            // Re-query availability
            const currentSlots = getAvailableSlots(session.doctorId!, session.date!);
            if (!currentSlots.includes(session.timeSlot!)) {
              throw new Error('SLOT_TAKEN');
            }

            // Create appointment
            db.prepare(`
              INSERT INTO appointments (patient_id, doctor_id, date, time_slot, status)
              VALUES (?, ?, ?, ?, 'confirmed')
            `).run(patientId, session.doctorId, session.date, session.timeSlot);
            db.exec('COMMIT');
          } catch (txErr) {
            try { db.exec('ROLLBACK'); } catch (_) {}
            throw txErr;
          }

          const patient = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(patientId) as any;
          const doctor = db.prepare('SELECT name, department FROM doctors WHERE id = ?').get(session.doctorId!) as any;
          
          // Sync to Google Spreadsheet in background
          syncAppointmentToGoogleSheet({
            patientName: patient.name,
            patientPhone: patient.phone,
            doctorName: doctor.name,
            date: session.date!,
            timeSlot: session.timeSlot!,
            status: 'confirmed'
          }).catch(err => console.error('Failed to sync appointment row:', err));

          const successMsg = {
            hi: `बधाई हो! ${doctor.name} (${doctor.department}) के साथ आपका अपॉइंटमेंट ${session.date} को ${session.timeSlot} बजे सफलतापूर्वक बुक हो गया है। कृपया समय पर अस्पताल पहुंचें।`,
            hinglish: `Mubarak ho! ${doctor.name} (${doctor.department}) ke sath aapka appointment ${session.date} ko ${session.timeSlot} par successfully book ho gaya hai. Kripya time par hospital pahuchein.`,
            en: `Congratulations! Your appointment with ${doctor.name} (${doctor.department}) on ${session.date} at ${session.timeSlot} has been successfully booked. Please arrive on time.`
          };
          await sendTextMessage(patientId, successMsg[lang]);
        } catch (err: any) {
          if (err.message === 'SLOT_TAKEN') {
            const takenMsg = {
              hi: 'क्षमा करें, यह समय स्लॉट अभी किसी और ने बुक कर लिया है। कृपया दोबारा प्रयास करें।',
              hinglish: 'Sorry, yeh slot abhi kisi aur ne book kar liya hai. Kripya dobara try karein.',
              en: 'Sorry, this slot has just been taken by another patient. Please try again.'
            };
            await sendTextMessage(patientId, takenMsg[lang]);
          } else {
            console.error('Booking transaction failed:', err);
            await sendTextMessage(patientId, 'Booking error occurred.');
          }
        }
      } else if (session.action === 'cancel') {
        db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(session.appointmentIdToModify);
        const successCancel = {
          hi: 'आपका अपॉइंटमेंट सफलतापूर्वक कैंसिल कर दिया गया है।',
          hinglish: 'Aapka appointment successfully cancel kar diya gaya hai.',
          en: 'Your appointment has been successfully cancelled.'
        };
        await sendTextMessage(patientId, successCancel[lang]);
      } else if (session.action === 'reschedule') {
        try {
          // Manual transaction (node:sqlite DatabaseSync has no .transaction() method)
          db.exec('BEGIN TRANSACTION');
          try {
            const currentSlots = getAvailableSlots(session.doctorId!, session.date!);
            if (!currentSlots.includes(session.timeSlot!)) {
              throw new Error('SLOT_TAKEN');
            }

            // Cancel old and create new/update
            db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(session.appointmentIdToModify);
            db.prepare(`
              INSERT INTO appointments (patient_id, doctor_id, date, time_slot, status)
              VALUES (?, ?, ?, ?, 'confirmed')
            `).run(patientId, session.doctorId, session.date, session.timeSlot);
            db.exec('COMMIT');
          } catch (txErr) {
            try { db.exec('ROLLBACK'); } catch (_) {}
            throw txErr;
          }

          const patient = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(patientId) as any;
          const doctor = db.prepare('SELECT name FROM doctors WHERE id = ?').get(session.doctorId!) as any;

          // Sync rescheduled appointment to Google Spreadsheet
          syncAppointmentToGoogleSheet({
            patientName: patient.name,
            patientPhone: patient.phone,
            doctorName: doctor.name,
            date: session.date!,
            timeSlot: session.timeSlot!,
            status: 'rescheduled'
          }).catch(err => console.error('Failed to sync rescheduled appointment row:', err));

          const successReschedule = {
            hi: `आपका अपॉइंटमेंट सफलतापूर्वक बदल दिया गया है। अब यह ${doctor.name} के साथ ${session.date} को ${session.timeSlot} बजे है।`,
            hinglish: `Aapka appointment successfully change ho gaya hai. Ab yeh ${doctor.name} ke sath ${session.date} ko ${session.timeSlot} baje hai.`,
            en: `Your appointment has been successfully rescheduled. It is now with ${doctor.name} on ${session.date} at ${session.timeSlot}.`
          };
          await sendTextMessage(patientId, successReschedule[lang]);
        } catch (err: any) {
          if (err.message === 'SLOT_TAKEN') {
            await sendTextMessage(patientId, 'Slot taken, reschedule failed.');
          } else {
            console.error('Reschedule failed:', err);
            await sendTextMessage(patientId, 'Rescheduling error.');
          }
        }
      }

      delete bookingSessions[patientId];
    } else {
      const cancelMsg = {
        hi: 'अपॉइंटमेंट की प्रक्रिया रद्द कर दी गई है।',
        hinglish: 'Appointment process cancel kar di gayi hai.',
        en: 'Appointment process has been aborted.'
      };
      await sendTextMessage(patientId, cancelMsg[lang]);
      delete bookingSessions[patientId];
    }
  }
}

function isHindiYes(str: string): boolean {
  return str.includes('हाँ') || str.includes('हा') || str.includes('sahi') || str.includes('karo') || str.includes('confirm');
}
