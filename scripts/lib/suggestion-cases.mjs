// What the check-in chat should suggest for each made-up student in measure-chat.mjs's suggestion
// cases, kept here so check-shortlist.mjs can check the app's short list against the same
// expectations: one student from each fixture group (scripts/fixtures/matching-cases.json) saying
// what they're into, and a few more asking about community societies, a worry, a sport, getting fit
// or the NHS. These are judgement calls, written down so they can be argued about.

import { CLUBS } from '#lib/sport/clubs.js';

export const CLUB_NAMES = CLUBS.map((club) => club.name);
/** Societies a beginner can start getting fitter with (Recreational Sport and Dance; not the women-only Girls Who Run). */
export const FITNESS_SOCIETIES = ['Pilates', 'Yoga', 'Walking', 'Cycling', 'Climbing', 'Dance'];

/** Promising beginner or social sessions it can't know about (a hedge or pointing to the card is fine). @param {string} text */
export function promisesSessions(text) {
  const promise = text
    .split(/(?<=[.!?])\s+/)
    .find(
      (sentence) =>
        /\b(beginner|beginners|social|taster|casual)\b[^.]*\b(session|sessions|class|classes|training|level)\b/i.test(sentence) &&
        !/\b(if|whether|might|may|could|card|check|see|look|find out|ask)\b/i.test(sentence)
    );
  return promise ? `promises sessions it can't know about ("${promise.trim().slice(0, 80)}")` : '';
}
/** A price or other money figure (the NHS Guide has them, with the date they were checked). @param {string} text */
export function givesPrices(text) {
  const price = text.match(/£\s?\d[\d,.]*|\b\d+(?:\.\d\d)?\s?(?:pounds|GBP)\b/i)?.[0];
  return price ? `gave a figure (${price})` : '';
}

/**
 * What we'd expect for each group. anyOf: at least one of these should be suggested (empty: nothing
 * really fits, so none is right). mustNot: suggesting any of these is wrong. askFirst: ask what they
 * enjoy instead of suggesting anything. page: an app page it should show. say: a check on its words.
 * @typedef {{ anyOf: string[], mustNot?: string[], askFirst?: boolean, page?: string, say?: (text: string) => string, why: string }} Expect
 */
/** @type {Record<string, Expect>} */
export const EXPECT = {
  'gigs, rules out sport': { anyOf: ['Music', 'Rock', 'Sync DJ', 'Gigs', 'Events'], mustNot: ['Sport', ...CLUB_NAMES], why: 'live music' },
  'homebody, rules out partying': { anyOf: ['Book', 'Chess', 'Gaming and Roleplay'], mustNot: ['Beer'], why: 'board games, reading' },
  'sporty early riser': {
    anyOf: ['Sport', 'Football', 'Futsal', 'Running'],
    // Cycling and Walking: what the old instructions kept suggesting to this footballer.
    mustNot: ['Esports', 'Chess', 'Video Game', 'Girls Who Run', 'Cycling', 'Walking'],
    why: 'football and the gym: the Football, Futsal or Running club, or the Sport service'
  },
  'lie-in and the cinema': { anyOf: ['Film', 'Film & TV Production', 'Art'], why: 'photography, the cinema' },
  'gamer, last minute (near tie)': { anyOf: ['Video Game', 'Esports', 'Gaming and Roleplay'], why: 'gaming' },
  'clubbing (synonyms for partying)': {
    anyOf: ['Sync DJ', 'Dance', 'Beats Cartel Dance', 'Salsa and Bachata', 'Events', 'Gigs'],
    mustNot: ['Claude Builder Club'],
    why: 'clubbing, festivals'
  },
  'outdoors, rules out the gym': { anyOf: ['Climbing', 'Outdoor Climbing', 'Walking', 'Mountaineering', 'Kayaking'], mustNot: ['Pilates', 'Yoga'], why: 'hiking, climbing' },
  'unrelated to every mentor': {
    anyOf: ['Hooked By Crochet', 'Stitch, Make & Bitch', 'Language Exchange'],
    // Walking: what the old instructions suggested for birdwatching, which Thomas didn't think fitted.
    mustNot: ['Conservation of Fine Art', 'Walking'],
    why: 'knitting'
  },
  "only says what they don't want in 3 answers": {
    anyOf: [],
    askFirst: true,
    mustNot: ['Esports', 'Video Game', 'Gaming and Roleplay', 'Dance', 'Sync DJ'],
    why: "only said they're not into sport, clubbing or gaming"
  },
  'quiet nights in, not nights out (opposites)': { anyOf: ['Book', 'Film'], mustNot: ['Beer', 'Dance', 'Sync DJ'], why: 'reading, films' },
  'live music (synonym for gigs)': { anyOf: ['Music', 'Rock', 'Gigs', 'Events'], why: 'live music, indie bands' }
};
export const EXTRA = [
  { group: 'interested in Ukrainian culture, not Ukrainian', message: "I'm not Ukrainian, but I'd love to learn more about Ukrainian culture and meet people. Are there any societies you'd recommend?", expect: { anyOf: ['Ukrainian'], why: 'Ukrainian says everyone is welcome' } },
  { group: 'a mature student', message: "I'm a mature student, so I'm a bit older than most people on my course. Are there any societies you'd recommend?", expect: { anyOf: ['Mature Students'], why: "they said they're in the group" } },
  { group: 'worried about money', message: "I'm really worried about money. My loan won't last until the end of term and I don't know what to do.", expect: { anyOf: ['Cost of Living', 'Advice Centre'], why: 'money worries: an NSU service, not advice' } },
  { group: 'run out of money for food', message: "I've run out of money for food this week and I'm not sure what to do.", expect: { anyOf: ['Food Pantry', 'Cost of Living'], why: 'food: the Food Pantry' } },
  { group: 'accused of plagiarism', message: "I've been accused of plagiarism in one of my essays and I'm panicking.", expect: { anyOf: ['Advice Centre'], why: 'academic misconduct: the Advice Centre' } },
  { group: "landlord won't fix the damp", message: "My landlord won't fix the damp in my flat and keeps ignoring my messages. Can I complain?", expect: { anyOf: ['Advice Centre', 'Rate Your Landlord'], why: 'housing and complaints: the Advice Centre' } },
  { group: 'swims a lot', message: "I swim a lot and I'd like to keep it up while I'm here. Any clubs or societies?", expect: { anyOf: ['Swimming'], why: 'swimming: the Swimming club' } },
  { group: 'played football at school', message: "I played football at school and I'd like to start playing again. Where should I look?", expect: { anyOf: ['Football', 'Futsal'], mustNot: ['American Football', 'Gaelic Football'], why: 'football: the Football or Futsal club' } },
  { group: 'into ice hockey', message: "I'm really into ice hockey. Is there anything for me here?", expect: { anyOf: ['Ice Hockey'], mustNot: ['Hockey'], why: 'ice hockey: the Ice Hockey society, not the Hockey club' } },
  {
    group: 'never done sport, wants to get fit',
    message: "I've never really done any sport, but I want to get fitter this year. Any ideas?",
    expect: { anyOf: [...CLUB_NAMES, ...FITNESS_SOCIETIES, 'Sport'], say: promisesSessions, why: 'a club or a beginner-friendly fitness society, pointing to the card for sessions rather than promising them' }
  },
  { group: 'do I pay to see a doctor', message: "I'm an international student. Do I have to pay to see a doctor here?", expect: { anyOf: [], page: 'NHS Guide', say: givesPrices, why: 'a short answer with no prices, and the NHS Guide' } },
  { group: 'how does the NHS work', message: "I've just arrived from abroad and I don't understand how the NHS works. Can you explain?", expect: { anyOf: [], page: 'NHS Guide', say: givesPrices, why: 'a short answer with no prices, and the NHS Guide' } }
];
for (const extra of EXTRA) EXPECT[extra.group] = extra.expect;
