const initialCategories = [
  { id: 'kitchen', name: 'Kitchen & Dining' },
  { id: 'cleaning', name: 'Cleaning & Hygiene' },
  { id: 'baby-kids', name: 'Baby & Kids' },
  { id: 'beauty', name: 'Beauty & Personal Care' },
  { id: 'melamine-crockery', name: 'Melamine & Crockery' },
  { id: 'toys', name: 'Toys & Games' },
  { id: 'home-household', name: 'Home & Household' },
  { id: 'womens-fashion', name: "Women's Fashion & Accessories" },
];

const initialDeliveryCharges = [
  {
    id: 'inside-dhaka',
    location: 'Inside Dhaka',
    charge: 60,
    estimatedDays: '1-2 Business Days',
    isDefault: true,
  },
  {
    id: 'outside-dhaka',
    location: 'Outside Dhaka',
    charge: 120,
    estimatedDays: '2-4 Business Days',
    isDefault: false,
  },
];

const initialProducts = [
  {
    id: 1,
    name: 'ট্যাপ ওয়াটার ফিল্টার - 360° রোটেটিং কিচেন কল ফিল্টার',
    price: 150,
    oldPrice: 200,
    discount: '-25%',
    category: 'kitchen',
    rating: 0,
    reviews: 0,
    tag: 'Daily Essential',
    stock: 50,
    thumbnail: 'https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80',
    videoUrl: '',
    description:
      'সহজেই কিচেনের যেকোনো পানির কলে সেট করা যায়। পানি পরিষ্কার ও ব্যাকটেরিয়ামুক্ত রাখতে কার্যকর এবং পানির অপচয় রোধ করে।',
    variants: [
      {
        colorName: 'Standard',
        colorCode: '#3B82F6',
        images: ['https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 2,
    name: 'ফ্রিজ ম্যাট ৪ পিস সেট - অ্যান্টি-ব্যাকটেরিয়াল ও ওয়াশেবল',
    price: 180,
    oldPrice: 250,
    discount: '-28%',
    category: 'kitchen',
    rating: 0,
    reviews: 0,
    tag: 'Popular',
    stock: 40,
    thumbnail: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=600&auto=format&fit=crop&q=80',
    description:
      'উন্নত মানের ওয়াটারপ্রুফ এবং ইজি-টু-ক্লিন ফ্রিজ ম্যাট সেট। ফ্রিজের তাকে দাগ ও ময়লা পড়া থেকে রক্ষা করে এবং পরিষ্কার রাখা সহজ করে।',
    variants: [
      {
        colorName: 'White',
        colorCode: '#FFFFFF',
        images: ['https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 3,
    name: 'হেভি ডিউটি কিচেন ক্লিনার স্প্রে - অয়েল ও গ্রীস রিমুভার',
    price: 280,
    oldPrice: 350,
    discount: '-20%',
    category: 'cleaning',
    rating: 0,
    reviews: 0,
    tag: 'Hot Deal',
    stock: 35,
    thumbnail: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=600&auto=format&fit=crop&q=80',
    description:
      'রান্নাঘরের তেলচিটে ও জেদি ময়লা নিমিষেই পরিষ্কার করতে অত্যন্ত কার্যকরী পাওয়ারফুল ক্লিনার। চুলা, সিঙ্ক ও কিচেন টাইলসের জন্য উপযুক্ত।',
    variants: [
      {
        colorName: 'Standard',
        colorCode: '#F59E0B',
        images: ['https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 4,
    name: 'টয়লেট ফ্লাশ ক্লিনার ট্যাবলেট - ডিওডোরাইজার ও ডিসইনফেক্টেন্ট',
    price: 180,
    oldPrice: 240,
    discount: '-25%',
    category: 'cleaning',
    rating: 0,
    reviews: 0,
    tag: 'Best Seller',
    stock: 60,
    thumbnail: 'https://images.unsplash.com/photo-1584813470613-5b1c1cad3d69?w=600&auto=format&fit=crop&q=80',
    description:
      'কমোডে সুগন্ধি ও দীর্ঘস্থায়ী পরিচ্ছন্নতা বজায় রাখে। প্রতিটি ফ্লাশে জীবাণু ধ্বংস করে এবং দুর্গন্ধ দূর করতে সাহায্য করে।',
    variants: [
      {
        colorName: 'Blue',
        colorCode: '#2563EB',
        images: ['https://images.unsplash.com/photo-1584813470613-5b1c1cad3d69?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 5,
    name: 'প্রিমিয়াম মেলামাইন জগ (২.২ লিটার রাউন্ড শেপ)',
    price: 320,
    oldPrice: 380,
    discount: '-16%',
    category: 'kitchen',
    rating: 0,
    reviews: 0,
    tag: 'Discount',
    stock: 25,
    thumbnail: 'https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80',
    description:
      'টেকসই ও আকর্ষণীয় ডিজাইনের ২.২ লিটার ফুড-গ্রেড মেলামাইন পানির জগ। দৈনন্দিন ব্যবহার ও মেহমানদারির জন্য উপযুক্ত।',
    variants: [
      {
        colorName: 'Classic White',
        colorCode: '#F1F5F9',
        images: ['https://images.unsplash.com/photo-1517256064527-09c73fc73e38?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 6,
    name: 'Smart Scalp Massager - ইলেকট্রিক হেড ম্যাসাজার',
    price: 580,
    oldPrice: 750,
    discount: '-23%',
    category: 'beauty',
    rating: 0,
    reviews: 0,
    tag: 'Trending',
    stock: 20,
    thumbnail: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&auto=format&fit=crop&q=80',
    description:
      'মাথার রক্ত সঞ্চালন বৃদ্ধি ও মানসিক ক্লান্তি দূর করতে স্মার্ট স্কাল্প ম্যাসাজার। চুল পড়া কমাতে ও আরামদায়ক ঘুমের জন্য সহায়ক।',
    variants: [
      {
        colorName: 'White',
        colorCode: '#FFFFFF',
        images: ['https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 7,
    name: 'আইস ফেইস রোলার - স্কিন গ্লো অ্যান্ড পাফিনেস রিমুভার',
    price: 150,
    oldPrice: 220,
    discount: '-32%',
    category: 'beauty',
    rating: 0,
    reviews: 0,
    tag: 'Top Rated',
    stock: 45,
    thumbnail: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80',
    description:
      'মুখের ফোলাভাব দূর করতে এবং ত্বক টানটান ও উজ্জ্বল রাখতে সিলিকন আইস ফেস রোলার। ব্রণ ও ডার্ক সার্কেল কমাতে সহায়ক।',
    variants: [
      {
        colorName: 'Pink',
        colorCode: '#F472B6',
        images: ['https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 8,
    name: 'মেলামাইন ৯ ইঞ্চি স্যুপ প্লেট - ব্রেক রেজিস্ট্যান্ট',
    price: 90,
    oldPrice: 110,
    discount: '-18%',
    category: 'kitchen',
    rating: 0,
    reviews: 0,
    tag: 'Special Offer',
    stock: 80,
    thumbnail: 'https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=600&auto=format&fit=crop&q=80',
    description:
      'উচ্চমানের ফুড-গ্রেড মেলামাইন দিয়ে তৈরি ৯ ইঞ্চি ডীপ স্যুপ প্লেট। দীর্ঘস্থায়ী, সহজে ভাঙে না এবং পরিষ্কার করা অত্যন্ত সহজ।',
    variants: [
      {
        colorName: 'White',
        colorCode: '#F8FAFC',
        images: ['https://images.unsplash.com/photo-1610701596007-11502861dcfa?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 9,
    name: 'বাচ্চাদের অ্যান্টি-স্লিপ হাঁটুর মোজা (নি-প্যাড প্রোটেক্টর)',
    price: 120,
    oldPrice: 180,
    discount: '-33%',
    category: 'baby-kids',
    rating: 0,
    reviews: 0,
    tag: 'Best Seller',
    stock: 65,
    thumbnail: 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=600&auto=format&fit=crop&q=80',
    description:
      'বাচ্চারা যখন হাঁটু গেড়ে হামাগুড়ি দেয় তখন হাঁটুকে মেঝেতে ঘষা ও আঘাত থেকে বাঁচাতে সফট ও কমফোর্টেবল অ্যান্টি-স্লিপ নি প্যড মোজা।',
    variants: [
      {
        colorName: 'Rosy Brown',
        colorCode: '#D39F9C',
        images: ['https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 10,
    name: 'প্রিমিয়াম মেলামাইন ডিনার প্লেট সেট (৬ পিস ফ্লোরাল ডিজাইন)',
    price: 540,
    oldPrice: 680,
    discount: '-21%',
    category: 'melamine-crockery',
    rating: 0,
    reviews: 0,
    tag: 'Best Seller',
    stock: 40,
    thumbnail: 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80',
    description:
      '১০০% ফুড-গ্রেড হেভি ওয়েট মেলামাইন ডিনার প্লেট সেট। আকর্ষণীয় ফ্লোরাল প্রিন্ট ও তাপ নিরোধক হওয়ায় প্রতিদিনের ব্যবহার ও অতিথি আপ্যায়নে সেরা।',
    variants: [
      {
        colorName: 'Floral White',
        colorCode: '#F8FAFC',
        images: ['https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 11,
    name: 'ম্যাজিক সিলিকন ডিশ ওয়াশিং গ্লাভস (স্ক্রাবারসহ ১ জোড়া)',
    price: 220,
    oldPrice: 300,
    discount: '-27%',
    category: 'cleaning',
    rating: 0,
    reviews: 0,
    tag: 'Daily Essential',
    stock: 55,
    thumbnail: 'https://images.unsplash.com/photo-1585837575652-267c041d77d4?w=600&auto=format&fit=crop&q=80',
    description:
      'হাতের ত্বক সুরক্ষিত রেখে থালা-বাসন, ফলমূল ও কিচেন সিঙ্ক পরিষ্কার করার জন্য নরম ব্রিসলযুক্ত হিট-রেজিস্ট্যান্ট সিলিকন গ্লাভস।',
    variants: [
      {
        colorName: 'Aqua Blue',
        colorCode: '#06B6D4',
        images: ['https://images.unsplash.com/photo-1585837575652-267c041d77d4?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 12,
    name: 'বাচ্চাদের শিক্ষণীয় কাঠের বর্ণমালা ও নম্বর পাজল বোর্ড',
    price: 250,
    oldPrice: 350,
    discount: '-29%',
    category: 'toys',
    rating: 0,
    reviews: 0,
    tag: 'Popular',
    stock: 45,
    thumbnail: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600&auto=format&fit=crop&q=80',
    description:
      'শিশুদের মেধা বিকাশ ও খেলার ছলে অক্ষর এবং সংখ্যা শেখার জন্য নিরাপদ রঙের প্রিমিয়াম কাঠের এডুকেশনাল পাজল বোর্ড।',
    variants: [
      {
        colorName: 'Multicolor',
        colorCode: '#F59E0B',
        images: ['https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 13,
    name: 'মাল্টিফাংশনাল ওয়াল মাউন্ট স্টোরেজ র‍্যাক ও অর্গানাইজার',
    price: 199,
    oldPrice: 280,
    discount: '-29%',
    category: 'home-household',
    rating: 0,
    reviews: 0,
    tag: 'Trending',
    stock: 70,
    thumbnail: 'https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?w=600&auto=format&fit=crop&q=80',
    description:
      'ড্রিল ছাড়াই দেয়ালে সহজে লাগানো যায় এমন শক্তিশালী অ্যাডহেসিভ স্টোরেজ র‍্যাক। বাথরুম, রান্নাঘর ও ড্রেসিং রুম গুছিয়ে রাখতে অত্যন্ত কার্যকর।',
    variants: [
      {
        colorName: 'Matte White',
        colorCode: '#F1F5F9',
        images: ['https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 14,
    name: 'কোরিয়ান স্টাইল পার্ল হেয়ার ক্লিপ ও ক্রিস্টাল ব্যান্ড সেট (৬ পিস)',
    price: 140,
    oldPrice: 200,
    discount: '-30%',
    category: 'womens-fashion',
    rating: 0,
    reviews: 0,
    tag: 'Top Rated',
    stock: 90,
    thumbnail: 'https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=600&auto=format&fit=crop&q=80',
    description:
      'আধুনিক ও মার্জিত ডিজাইনের মুক্তা এবং ক্রিস্টাল খচিত প্রিমিয়াম হেয়ার ক্লিপ সেট। যেকোনো পার্টি বা প্রতিদিনের ফ্যাশনের জন্য মানানসই।',
    variants: [
      {
        colorName: 'Pearl Gold',
        colorCode: '#FBBF24',
        images: ['https://images.unsplash.com/photo-1535295972055-1c762f4483e5?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 15,
    name: 'স্টেইনলেস স্টিল অয়েল ডিসপেনসার বোতল (৫০০ মিলি লিক-প্রুফ)',
    price: 290,
    oldPrice: 380,
    discount: '-24%',
    category: 'kitchen',
    rating: 0,
    reviews: 0,
    tag: 'Hot Deal',
    stock: 38,
    thumbnail: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80',
    description:
      'রান্নার তেল পরিমিত ও ঝামেলাহীনভাবে ঢালার জন্য ড্রিপ-ফ্রি নজলযুক্ত প্রিমিয়াম ফুড-গ্রেড অয়েল ডিসপেনসার বোতল।',
    variants: [
      {
        colorName: 'Silver',
        colorCode: '#94A3B8',
        images: ['https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
  {
    id: 16,
    name: 'মেলামাইন কারি ও সার্ভিং বোল সেট ঢাকনাসহ (৩ পিস)',
    price: 450,
    oldPrice: 560,
    discount: '-20%',
    category: 'melamine-crockery',
    rating: 0,
    reviews: 0,
    tag: 'Special Offer',
    stock: 30,
    thumbnail: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=600&auto=format&fit=crop&q=80',
    description:
      'খাবার গরম ও সতেজ রাখতে এয়ার-টাইট ঢাকনাসহ ৩টি ভিন্ন সাইজের মেলামাইন সার্ভিং বোল সেট।',
    variants: [
      {
        colorName: 'Ivory White',
        colorCode: '#F8FAFC',
        images: ['https://images.unsplash.com/photo-1541544741938-0af808871cc0?w=600&auto=format&fit=crop&q=80'],
      },
    ],
  },
].map((p) => ({
  ...p,
  collections: {
    bestSelling: Boolean(p.tag?.toLowerCase().includes('best') || p.tag?.toLowerCase().includes('top')),
    newArrival: Boolean(p.tag?.toLowerCase().includes('trending') || p.tag?.toLowerCase().includes('essential') || p.tag?.toLowerCase().includes('new')),
    hotOffer: Boolean(p.discount || p.tag?.toLowerCase().includes('hot') || p.tag?.toLowerCase().includes('deal')),
    popular: Boolean(p.tag?.toLowerCase().includes('popular') || p.id === 2 || p.id === 12),
  },
}));

// No pre-seeded reviews or dummy orders — all data is 100% genuine and placed by actual customers
const initialReviews = [];
const initialOrders = [];

// Fallback in-memory store used seamlessly when MongoDB URI is not yet connected
const memoryStore = {
  users: [],
  products: initialProducts.map((p) => ({ ...p })),
  reviews: initialReviews.map((r) => ({ ...r })),
  categories: initialCategories.map((c) => ({ ...c })),
  deliveryCharges: initialDeliveryCharges.map((d) => ({ ...d })),
  orders: initialOrders.map((o) => ({ ...o })),
  preOrders: [],
};

module.exports = {
  initialCategories,
  initialDeliveryCharges,
  initialProducts,
  initialReviews,
  initialOrders,
  memoryStore,
};

