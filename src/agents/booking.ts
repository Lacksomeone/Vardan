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

// Get day name from date string
function getDayName(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const date = new Date(dateStr);
  return days[date.getDay()];
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

// Parse date text (e.g. "tomorrow", "12 July", "Monday") into YYYY-MM-DD
async function parseDateWithLLM(text: string): Promise<string | null> {
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
        hi: `क्या आप Dr. ${activeAppt.doctor_name} के साथ ${activeAppt.date} (${activeAppt.time_slot}) का अपॉइंटमेंट कैंसिल करना चाहते हैं? कृपया "हाँ" या "नहीं" लिखकर भेजें।`,
        hinglish: `Kya aap Dr. ${activeAppt.doctor_name} ke sath ${activeAppt.date} (${activeAppt.time_slot}) ka appointment cancel karna chahte hain? Kripya "Haan" ya "Nahi" likhein.`,
        en: `Do you want to cancel your appointment with Dr. ${activeAppt.doctor_name} on ${activeAppt.date} (${activeAppt.time_slot})? Please reply with "Yes" or "No".`
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
        stage: 'doctor_or_symptom',
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

    // Default: Start booking flow
    bookingSessions[patientId] = { stage: 'doctor_or_symptom', action: 'book' };

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

    // Check direct name match
    const lowerText = text.toLowerCase();
    for (const doc of doctors) {
      const docNameClean = doc.name.toLowerCase().replace('dr.', '').trim();
      if (lowerText.includes(docNameClean) || lowerText.includes(doc.name.toLowerCase())) {
        selectedDoc = doc;
        break;
      }
    }

    // Symptom mapping if doctor is not specified
    if (!selectedDoc) {
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
      hi: `Dr. ${doctor.name} (${doctor.department}) के लिए तारीख बताएं।\n\nउपलब्ध दिन: *${availableDays}*\n\nउदाहरण: कल, सोमवार, 15 July`,
      hinglish: `Dr. ${doctor.name} (${doctor.department}) ke liye date batayein.\n\nAvailable days: *${availableDays}*\n\nExample: kal, Monday, 15 July`,
      en: `Please specify the date for Dr. ${doctor.name} (${doctor.department}).\n\nAvailable days: *${availableDays}*\n\nExample: tomorrow, Monday, July 15`
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

    const today = new Date(); today.setHours(0,0,0,0);
    const [year, month, day] = parsedDate.split('-').map(Number);
    const chosenDate = new Date(year, month - 1, day);
    if (chosenDate < today) {
      const pastDate = {
        hi: 'पिछली तारीख नहीं चुन सकते। कृपया आने वाले समय की तारीख बताएं।',
        hinglish: 'Past date select nahi kar sakte. Future date batayein.',
        en: 'Cannot select a past date. Please select a future date.'
      };
      await sendTextMessage(patientId, pastDate[lang]);
      return;
    }

    if (chosenDate.getDay() === 0) {
      const sundayClosed = {
        hi: 'रविवार को OPD बंद रहती है। कोई अन्य दिन चुनें।',
        hinglish: 'Sunday ko OPD closed hai. Koi aur day select karein.',
        en: 'OPD is closed on Sundays. Please select another day.'
      };
      await sendTextMessage(patientId, sundayClosed[lang]);
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
      db.transaction(() => {
        const currentSlots = getAvailableSlots(session.doctorId!, session.date!);
        if (!currentSlots.includes(session.timeSlot!)) {
          throw new Error('SLOT_TAKEN');
        }
        db.prepare(`
          INSERT INTO appointments (patient_id, doctor_id, date, time_slot, status)
          VALUES (?, ?, ?, ?, 'confirmed')
        `).run(patientId, session.doctorId, session.date, session.timeSlot);
      })();

      const patientForBook = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(patientId) as any;

      // Auto-schedule follow-up reminder 9 days after appointment
      const apptDateObj = new Date(session.date!);
      apptDateObj.setDate(apptDateObj.getDate() + 9);
      const followUpDateStr = apptDateObj.toISOString().split('T')[0];
      try {
        db.prepare(`
          INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status)
          VALUES (?, ?, ?, 'medicine_reminder', 'pending')
        `).run(patientId, session.doctorId, followUpDateStr);
        console.log(`[FollowUp] Auto-scheduled for ${patientForBook.name} on ${followUpDateStr}`);
      } catch (fuErr) {
        console.error('[FollowUp] Failed to schedule:', fuErr);
      }

      // Sync to Google Sheets
      syncAppointmentToGoogleSheet({
        patientName: patientForBook.name,
        patientPhone: patientForBook.phone,
        doctorName: doctorForBook.name,
        date: session.date!,
        timeSlot: session.timeSlot!,
        status: 'confirmed'
      }).catch(err => console.error('Failed to sync appointment to Google Sheets:', err));

      const autoBookedMsg = {
        hi: `✅ आपका अपॉइंटमेंट Dr. ${doctorForBook.name} (${doctorForBook.department}) के साथ ${session.date} को ${session.timeSlot} बजे बुक हो गया है! कृपया समय पर अस्पताल पहुंचें।`,
        hinglish: `✅ Aapka appointment Dr. ${doctorForBook.name} (${doctorForBook.department}) ke sath ${session.date} ko ${session.timeSlot} par book ho gaya hai! Kripya time par hospital pahuchein.`,
        en: `✅ Your appointment with Dr. ${doctorForBook.name} (${doctorForBook.department}) on ${session.date} at ${session.timeSlot} has been booked! Please arrive on time.`
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
          db.transaction(() => {
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
          })();

          const patient = db.prepare('SELECT name, phone FROM patients WHERE id = ?').get(patientId) as any;
          const doctor = db.prepare('SELECT name, department FROM doctors WHERE id = ?').get(session.doctorId!) as any;
          
          // Auto-schedule follow-up reminder 9 days after appointment (for 10-day medicine course)
          const apptDate = new Date(session.date!);
          apptDate.setDate(apptDate.getDate() + 9);
          const followUpDate = apptDate.toISOString().split('T')[0];
          
          try {
            db.prepare(`
              INSERT INTO follow_up_jobs (patient_id, doctor_id, trigger_date, message_template, status)
              VALUES (?, ?, ?, 'medicine_reminder', 'pending')
            `).run(patientId, session.doctorId, followUpDate);
            console.log(`[FollowUp] Auto-scheduled reminder for ${patient.name} on ${followUpDate}`);
          } catch (err) {
            console.error('[FollowUp] Failed to schedule:', err);
          }

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
            hi: `बधाई हो! Dr. ${doctor.name} (${doctor.department}) के साथ आपका अपॉइंटमेंट ${session.date} को ${session.timeSlot} बजे सफलतापूर्वक बुक हो गया है। कृपया समय पर अस्पताल पहुंचें।`,
            hinglish: `Mubarak ho! Dr. ${doctor.name} (${doctor.department}) ke sath aapka appointment ${session.date} ko ${session.timeSlot} par successfully book ho gaya hai. Kripya time par hospital pahuchein.`,
            en: `Congratulations! Your appointment with Dr. ${doctor.name} (${doctor.department}) on ${session.date} at ${session.timeSlot} has been successfully booked. Please arrive on time.`
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
          db.transaction(() => {
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
          })();

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
            hi: `आपका अपॉइंटमेंट सफलतापूर्वक बदल दिया गया है। अब यह Dr. ${doctor.name} के साथ ${session.date} को ${session.timeSlot} बजे है।`,
            hinglish: `Aapka appointment successfully change ho gaya hai. Ab yeh Dr. ${doctor.name} ke sath ${session.date} ko ${session.timeSlot} baje hai.`,
            en: `Your appointment has been successfully rescheduled. It is now with Dr. ${doctor.name} on ${session.date} at ${session.timeSlot}.`
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
