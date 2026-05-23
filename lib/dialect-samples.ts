/** Regional cue chips + RegSpeech12 sample phrases (from factory-VERIDYN dialect lab). */

export interface DialectSample {
  id: string;
  label: string;
  phrase: string;
  dialect: string;
  region: string;
  source: string;
}

export const DIALECT_CUE_CHIPS: DialectSample[] = [
  {
    id: "sylhet",
    label: "Sylhet",
    phrase: "আমি সিলেটি ভাষায় কথা কই",
    dialect: "sylhet",
    region: "Sylhet",
    source: "phrase_chip",
  },
  {
    id: "barishal",
    label: "Barishal",
    phrase: "আমি বরিশালে থাকি",
    dialect: "barishal",
    region: "Barishal",
    source: "phrase_chip",
  },
  {
    id: "chittagong",
    label: "Chattogram",
    phrase: "আমি চট্টগ্রামের মানুষ",
    dialect: "chittagong",
    region: "Chattogram",
    source: "phrase_chip",
  },
  {
    id: "noakhali",
    label: "Noakhali",
    phrase: "নোয়াখালীতে আইজ বৃষ্টি হইব",
    dialect: "noakhali",
    region: "Noakhali",
    source: "phrase_chip",
  },
];

export const DIALECT_SAMPLES: DialectSample[] = [
  ...DIALECT_CUE_CHIPS,
  {
    id: "noakhali-long",
    label: "Noakhali sample",
    phrase:
      "অন কথা হচ্ছে আমরা তো ইয়ানে আড্ডাদি না বন্ধু। আমরা আড্ডাদি মেলা দূর একজাগাত। কোনাই? সুজাহুর, সুজাহুর তো তুই চিনতি ন। সুজাপুরের নাম শুনছিলাম মনে অয়। অনেক দূরে",
    dialect: "noakhali",
    region: "Noakhali",
    source: "RegSpeech12",
  },
  {
    id: "chittagong-long",
    label: "Chittagong sample",
    phrase:
      "কী অবস্তা ভাইয়া, তুঁই গম আসো না? অ বালা আছি। তোঁয়ার বাড়ি খডে দে ভাইয়্যে? আঁর বাড়ি অইলদি কক্সবাজারর চকরিয়া।",
    dialect: "chittagong",
    region: "Chittagong",
    source: "RegSpeech12",
  },
  {
    id: "sylhet-long",
    label: "Sylhet sample",
    phrase:
      "তে খইনছাইন আফনের দিনখান, দিনখাল কিলাখান যায় তে? বালা যার, বাক্কা বালা যার, আফনার কিতা অবস্থা?",
    dialect: "sylhet",
    region: "Sylhet",
    source: "RegSpeech12",
  },
  {
    id: "barishal-long",
    label: "Barishal sample",
    phrase:
      "আসসালামু আলাইকুম, আমার নাম হাসিবুর রহমান শুব, ডিপারমেন্ট অব সপটোওয়্যার ইনজিনারিং, ফাস্ট সেমিস্টার, ব্যাচ নাম্বার ফোরটি। আমি ড্যাফোডিল ইন্টারন্যাশনাল ইউনিবার্সিটিতে পড়াশুনা করতেছি। আর আমার হোম টাউন হচ্ছে হলো বরিশালে।",
    dialect: "barishal",
    region: "Barishal",
    source: "RegSpeech12",
  },
  {
    id: "rangpur",
    label: "Rangpur sample",
    phrase: "সুমন তারপর হইলো রানা, তারপর জসিম, জাকারিয়া এরা কয়েকঝনের নাম দিছলাম ওটে।",
    dialect: "rangpur",
    region: "Rangpur",
    source: "RegSpeech12",
  },
  {
    id: "sandwip",
    label: "Sandwip sample",
    phrase:
      "আইচ্ছা। আমনেরা এনজিও সম্পর্কে কিছু জানেন নে? জানি। তো এনজিও, টাকা লই না, আইচ্ছা, হিয়াল্লাই জানি, আইচ্ছা।",
    dialect: "sandwip",
    region: "Sandwip",
    source: "RegSpeech12",
  },
];

export const DIALECT_OPTIONS = [
  { value: "barishal", label: "Barishal / বরিশাল" },
  { value: "chittagong", label: "Chittagong / চট্টগ্রাম" },
  { value: "noakhali", label: "Noakhali / নোয়াখালী" },
  { value: "rangpur", label: "Rangpur / রংপুর" },
  { value: "sandwip", label: "Sandwip / সন্দ্বীপ" },
  { value: "sylhet", label: "Sylhet / সিলেট" },
  { value: "dhaka", label: "Dhaka / ঢাকা" },
  { value: "", label: "Unknown" },
];
