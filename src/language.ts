export function detectLanguage(text: string): string {
  const bmWords = [
    'saya', 'awak', 'kamu', 'ini', 'itu', 'dan', 'di', 'ke', 'dari',
    'yang', 'tidak', 'ada', 'boleh', 'tolong', 'nak', 'dah', 'ni', 'tu',
    'x', 'bagi', 'dekat', 'kat', 'mintak', 'minta', 'saja', 'je', 'lagi',
    'sudah', 'akan', 'untuk', 'dengan', 'pada', 'sebab', 'kalau', 'bila',
    'mana', 'siapa', 'macam', 'pasal', 'tau', 'tahu', 'buat', 'pergi',
    'sini', 'sana', 'situ', 'banyak', 'sikit', 'sgt', 'sangat',
  ];

  const enWords = [
    'i', 'me', 'my', 'the', 'this', 'that', 'please', 'help', 'want',
    'can', 'have', 'has', 'was', 'were', 'been', 'need', 'would', 'could',
    'should', 'there', 'their', 'they', 'them', 'what', 'when', 'where',
    'who', 'why', 'how', 'about', 'because', 'but', 'also', 'just',
    'like', 'know', 'think', 'going', 'said', 'people', 'very', 'really',
    'thing', 'things', 'something', 'much', 'many', 'more', 'some', 'any',
  ];

  const lower = text.toLowerCase();
  const words = lower.split(/[^a-zA-Z]+/).filter(Boolean);

  if (words.length === 0) return 'ms';

  let bmScore = 0;
  let enScore = 0;

  for (const word of words) {
    if (bmWords.includes(word)) bmScore++;
    if (enWords.includes(word)) enScore++;
  }

  if (bmScore > enScore) return 'ms';
  if (enScore > bmScore) return 'en';
  return 'ms';
}
