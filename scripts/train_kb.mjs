// Train Vardan Hospital Knowledge Base with detailed real data
// Run: node --experimental-sqlite scripts/train_kb.mjs

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, '../data/vardan.db'));

// ── Helper ──────────────────────────────────────────────────────────────────
function upsert(category, question_variants, answer_hi, answer_hinglish, answer_en) {
  const existing = db.prepare('SELECT id FROM knowledge_base WHERE category = ?').get(category);
  if (existing) {
    db.prepare(`
      UPDATE knowledge_base 
      SET question_variants = ?, answer_hi = ?, answer_hinglish = ?, answer_en = ?, updated_at = datetime('now')
      WHERE category = ?
    `).run(
      JSON.stringify(question_variants), answer_hi, answer_hinglish, answer_en, category
    );
    console.log(`✏️  Updated: ${category}`);
  } else {
    db.prepare(`
      INSERT INTO knowledge_base (category, question_variants, answer_hi, answer_hinglish, answer_en)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      category, JSON.stringify(question_variants), answer_hi, answer_hinglish, answer_en
    );
    console.log(`✅ Inserted: ${category}`);
  }
}

// ── 1. TIMINGS (Updated: 24x7) ───────────────────────────────────────────────
upsert(
  'timings',
  ['hospital timing', 'opening hours', 'what time does it open', 'kab khulta hai', 'timing kya hai', 'samay', 'opd timing', 'hospital open time', 'band kab hota', 'close time', 'kab band', '24 hours', 'raat ko khula'],
  'वरदान हॉस्पिटल 24 घंटे, सातों दिन (24x7) खुला रहता है। OPD, Emergency, ICU – सभी सेवाएं हर समय उपलब्ध हैं।',
  'Vardan Hospital 24 ghante, 7 din (24x7) khula rehta hai. OPD, Emergency, ICU – sabhi services hamesha available hain.',
  'Vardan Hospital is open 24 hours a day, 7 days a week. OPD, Emergency, ICU – all services are available around the clock.'
);

// ── 2. LOCATION (Updated with full address) ──────────────────────────────────
upsert(
  'location',
  ['location', 'address', 'where is it', 'kahan hai', 'pata kya hai', 'route', 'map', 'direction', 'bahraich location', 'hospital address', 'adnan complex', 'rto road', 'nazir pura', 'rajapur mafi'],
  'वरदान हॉस्पिटल का पता है: RTO Office Road, Adnan Complex के पास, नज़ीर पुरा, राजापुर माफ़ी, बहराइच, उत्तर प्रदेश – 271801। Google Maps पर "Vardan Hospital Bahraich" सर्च करें।',
  'Vardan Hospital ka address hai: RTO Office Road, near Adnan Complex, Nazir Pura, Rajapur Mafi, Bahraich, Uttar Pradesh – 271801. Google Maps par "Vardan Hospital Bahraich" search karein.',
  'Vardan Hospital is located at: RTO Office Road, near Adnan Complex, Nazir Pura, Rajapur Mafi, Bahraich, Uttar Pradesh – 271801. Search "Vardan Hospital Bahraich" on Google Maps for navigation.'
);

// ── 3. CONTACT / PHONE NUMBERS ───────────────────────────────────────────────
upsert(
  'contact',
  ['phone number', 'contact', 'call', 'helpline', 'number kya hai', 'phone karo', 'call kaise karein', 'reception number', 'hospital number', 'reach'],
  'वरदान हॉस्पिटल के फ़ोन नंबर: +91 83181 41915 या +91 97247 12270। आप किसी भी समय कॉल कर सकते हैं।',
  'Vardan Hospital ke phone numbers hain: +91 83181 41915 ya +91 97247 12270. Aap kisi bhi time call kar sakte hain.',
  'You can contact Vardan Hospital at: +91 83181 41915 or +91 97247 12270. Feel free to call anytime.'
);

// ── 4. EMERGENCY (Updated with new numbers) ──────────────────────────────────
upsert(
  'emergency',
  ['emergency', 'icu', 'accident', 'serious patient', 'ambulance', 'aapatkalin', 'urgency', 'critical', 'life support', 'iccu', 'ircu', 'intensive care'],
  'वरदान हॉस्पिटल में 24 घंटे आपातकालीन सेवाएं उपलब्ध हैं। हमारे पास 11-बेडेड ICCU/IRCU (Intensive Cardiac Care Unit) है जिसमें डायलिसिस और आधुनिक लाइफ-सपोर्ट की सुविधा है। आपातकाल में +91 83181 41915 पर तुरंत कॉल करें।',
  'Vardan Hospital mein 24 ghante emergency services available hain. Hamare paas 11-bedded ICCU/IRCU hai jisme dialysis aur modern life-support ki facility hai. Emergency mein +91 83181 41915 par turant call karein.',
  'Vardan Hospital offers 24/7 emergency services. We have an 11-bedded ICCU/IRCU with dialysis and modern life-support facilities. In emergencies, call +91 83181 41915 immediately.'
);

// ── 5. INSURANCE ─────────────────────────────────────────────────────────────
upsert(
  'insurance',
  ['insurance', 'ayushman card', 'cashless', 'tpa', 'health insurance', 'ayushman bharat', 'claim', 'bima', 'free treatment', 'government scheme'],
  'वरदान हॉस्पिटल आयुष्मान भारत योजना और प्रमुख स्वास्थ्य बीमा कंपनियों के साथ कैशलेस इलाज की सुविधा देता है। साथ ही, अस्पताल विशेष निःशुल्क स्वास्थ्य शिविर (Health Camps) भी आयोजित करता है। रिसेप्शन पर कार्ड वेरीफाई करें।',
  'Vardan Hospital Ayushman Bharat scheme aur major health insurance companies ke sath cashless treatment ki facility deta hai. Sath hi, free health camps bhi organize karta hai. Reception par card verify karein.',
  'Vardan Hospital supports Ayushman Bharat and major health insurance providers for cashless treatment. The hospital also organizes free health camps for the community. Please verify your card at the reception.'
);

// ── 6. SPECIALITIES ──────────────────────────────────────────────────────────
upsert(
  'specialities',
  ['speciality', 'department', 'which doctor', 'kaunsa department', 'neurology', 'general physician', 'maternity', 'specialisation', 'treatment available', 'kya kya hota hai yahan', 'facilities'],
  'वरदान हॉस्पिटल एक मल्टी-स्पेशलिटी अस्पताल है। मुख्य विभाग: सामान्य चिकित्सा (General Medicine), न्यूरोलॉजी (Neurology), और मातृत्व (Maternity)। इसके अलावा: रेस्पिरेटरी क्लिनिक, एलर्जी क्लिनिक, स्लीप सेंटर, और हेमेटोलॉजी-ऑन्कोलॉजी (कीमोथेरेपी) भी उपलब्ध है।',
  'Vardan Hospital ek multi-speciality hospital hai. Main departments: General Medicine, Neurology, aur Maternity. Iske alawa: Respiratory Clinic, Allergy Clinic, Sleep Center, aur Hematology-Oncology (Chemotherapy) bhi available hain.',
  'Vardan Hospital is a multi-speciality facility. Key departments: General Medicine, Neurology, and Maternity. Additional specialities include Respiratory Clinic, Allergy Clinic, Sleep Center, and a Hematology-Oncology unit with chemotherapy options.'
);

// ── 7. SURGERY & OT ──────────────────────────────────────────────────────────
upsert(
  'surgery',
  ['operation', 'surgery', 'ot', 'operation theatre', 'joint replacement', 'urosurgery', 'neurosurgery', 'operation kab hoga', 'surgical', 'modular ot'],
  'वरदान हॉस्पिटल में आधुनिक मॉड्यूलर ऑपरेशन थिएटर (OT) हैं जो बड़ी सर्जरी के लिए पूरी तरह सुसज्जित हैं – जिनमें जॉइंट रिप्लेसमेंट, यूरोसर्जरी, और न्यूरोसर्जरी शामिल हैं।',
  'Vardan Hospital mein modern modular Operation Theatres (OT) hain jo major surgeries ke liye fully equipped hain – jisme joint replacement, urosurgery, aur neurosurgery shamil hain.',
  'Vardan Hospital has modular operation theatres fully equipped for major procedures including joint replacement surgery, urosurgery, and neurosurgery.'
);

// ── 8. DIAGNOSTICS & LABS ────────────────────────────────────────────────────
upsert(
  'diagnostics',
  ['xray', 'x-ray', 'sonography', 'ultrasound', 'blood test', 'lab', 'laboratory', 'test', 'diagnostic', 'report', 'endoscopy', 'bronchoscopy', 'laparoscopy', 'pathology', 'janch'],
  'वरदान हॉस्पिटल में इन-हाउस लैब टेस्टिंग, X-Ray, और सोनोग्राफी की सुविधा है। इसके अलावा एक समर्पित एंडोस्कोपी, ब्रोंकोस्कोपी, और लैप्रोस्कोपी यूनिट भी उपलब्ध है।',
  'Vardan Hospital mein in-house lab testing, X-Ray, aur sonography ki facility hai. Iske alawa dedicated endoscopy, bronchoscopy, aur laparoscopy unit bhi available hai.',
  'Vardan Hospital offers in-house lab testing, X-Ray, and sonography. There is also a dedicated unit for endoscopy, bronchoscopy, and laparoscopy procedures.'
);

// ── 9. RATINGS & REPUTATION ──────────────────────────────────────────────────
upsert(
  'ratings',
  ['rating', 'review', 'good hospital', 'kaisa hospital hai', 'trusted', 'best hospital', 'feedback', 'quality', 'cleanliness', 'staff'],
  'वरदान हॉस्पिटल को Justdial पर 5 में से 5 स्टार रेटिंग मिली है। मरीज़ विशेष रूप से साफ-सफाई, तेज़ आपातकालीन प्रतिक्रिया, और पॉलाइट स्टाफ की तारीफ़ करते हैं।',
  'Vardan Hospital ko Justdial par 5 mein se 5 star rating mili hai. Patients specially cleanliness, fast emergency response, aur polite staff ki tarif karte hain.',
  'Vardan Hospital holds a 5.0 out of 5-star rating on Justdial. Patients frequently praise the cleanliness, quick emergency response, and helpful, polite staff.'
);

// ── 10. APPOINTMENT BOOKING ──────────────────────────────────────────────────
upsert(
  'appointment',
  ['appointment', 'book', 'slot', 'appoint', 'appointment kaise lein', 'doctor se milna', 'time lena', 'schedule', 'book karna'],
  'आप WhatsApp पर ही अपॉइंटमेंट बुक कर सकते हैं। बस लिखें "Book Appointment" या "Doctor se milna hai" – मैं आपको डॉक्टर और समय चुनने में मदद करूँगा।',
  'Aap WhatsApp pe hi appointment book kar sakte hain. Bas likhein "Book Appointment" ya "Doctor se milna hai" – main aapko doctor aur time choose karne mein help karunga.',
  'You can book an appointment directly on WhatsApp. Just type "Book Appointment" or "Doctor se milna hai" and I will guide you to select a doctor and time slot.'
);

// ── 11. WHEELCHAIR / ACCESSIBILITY ──────────────────────────────────────────
upsert(
  'accessibility',
  ['wheelchair', 'disabled', 'divyang', 'parking', 'accessible', 'ramp', 'physically challenged', 'disability'],
  'वरदान हॉस्पिटल पूरी तरह से व्हीलचेयर-सुलभ है। पार्किंग एवं मुख्य प्रवेश द्वार दोनों दिव्यांगजनों के लिए सुगम हैं।',
  'Vardan Hospital fully wheelchair-accessible hai. Parking aur main entrance dono divyangon ke liye convenient hain.',
  'Vardan Hospital is fully wheelchair-accessible. Both the parking lot and main entrance are designed to accommodate physically challenged patients.'
);

// ── 12. BONE MARROW / ONCOLOGY ──────────────────────────────────────────────
upsert(
  'oncology',
  ['cancer', 'chemotherapy', 'oncology', 'bone marrow', 'hematology', 'blood cancer', 'daycare chemo', 'tumor', 'kemo'],
  'वरदान हॉस्पिटल में एक इन-हाउस हेमेटोलॉजी-ऑन्कोलॉजी यूनिट है जिसमें बोन मैरो ट्रांसप्लांट और डेकेयर कीमोथेरेपी की सुविधा उपलब्ध है।',
  'Vardan Hospital mein in-house hematology-oncology unit hai jisme bone marrow transplant aur daycare chemotherapy ki facility available hai.',
  'Vardan Hospital has an in-house hematology-oncology unit offering bone marrow transplant and daycare chemotherapy options.'
);

// ── 13. FREE HEALTH CAMPS ────────────────────────────────────────────────────
upsert(
  'health_camps',
  ['free camp', 'health camp', 'muft', 'free checkup', 'camp', 'community', 'outreach', 'nishulk', 'free service', 'subsidy'],
  'वरदान हॉस्पिटल समय-समय पर विशेष निःशुल्क स्वास्थ्य शिविर (Health Camps) और सब्सिडी वाले स्वास्थ्य कार्यक्रम आयोजित करता है। ताज़ा जानकारी के लिए रिसेप्शन पर संपर्क करें।',
  'Vardan Hospital time-to-time special free health camps aur subsidised healthcare programs organize karta hai. Latest updates ke liye reception par contact karein.',
  'Vardan Hospital regularly organizes free health camps and subsidised healthcare programs for the community. Contact the reception for the latest schedule.'
);

// ── 14. SLEEP CENTER / RESPIRATORY / ALLERGY ────────────────────────────────
upsert(
  'speciality_clinics',
  ['sleep', 'allergy', 'respiratory', 'breathing', 'asthma', 'saans', 'neend', 'sleep apnea', 'lung', 'respiratory test', 'pulmonology'],
  'वरदान हॉस्पिटल में विशेष श्वसन परीक्षण केंद्र (Respiratory Test Center), एलर्जी क्लिनिक, और स्लीप सेंटर उपलब्ध हैं। सांस, एलर्जी, या नींद की समस्याओं के लिए यहाँ विशेषज्ञ डॉक्टर हैं।',
  'Vardan Hospital mein specialized Respiratory Test Center, Allergy Clinic, aur Sleep Center available hain. Saans, allergy, ya neend ki samasya ke liye yahan expert doctors hain.',
  'Vardan Hospital has specialized Respiratory Test Centers, Allergy Clinics, and a Sleep Center. Expert doctors are available for breathing difficulties, allergies, and sleep disorders.'
);

console.log('\n🎉 Knowledge Base training complete! All entries upserted successfully.');

const total = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get();
console.log(`📊 Total KB entries: ${total.count}`);
