// The everyday words students use for what the chat can suggest, so the app can pick a short list of
// likely societies, clubs and services for each message (shortlist.js). Gemini then chooses from that
// list. A name on its own also counts (someone who says "salsa" or "Ice Hockey"), apart from the few in
// NOT_BY_NAME. Every name here must be one in catalogue.js: scripts/check-shortlist.mjs checks.
//
// Words are compared as shortlist.js reads them: lower case, without punctuation, and with a final "s"
// taken off ("gigs" reads as "gig"), so one form of a word is usually enough. The longest phrase wins,
// so "ice hockey" never counts as "hockey", and "rock climbing" never as "rock".
// No Firebase here, so the checks can use it in Node.

/**
 * say: what students say; mean: the names it may point to, most likely first. need: help with a
 * worry (money, food, housing and so on), which "not" or "don't" never rules out ("I don't have money
 * for food" still needs the Food Pantry). weak: a general word that only counts a little, so it never
 * crowds out something they actually named. rulesOutClubs: ruling this out ("Not sport.") rules out
 * every Northumbria Sport club too.
 * @typedef {{ say: string[], mean: string[], need?: true, weak?: true, rulesOutClubs?: true }} Everyday
 */

/** @type {readonly Everyday[]} */
export const EVERYDAY = Object.freeze([
  // ---------- Sport: Northumbria Sport's clubs, and the sporty societies ----------
  { say: ['sport', 'sporty', 'sports club', 'team sport', 'play sport', 'playing sport'], mean: ['Sport'], rulesOutClubs: true },
  { say: ['football', 'soccer', 'footy', 'five a side', '5 a side', '5s', 'premier league'], mean: ['Football', 'Futsal'] },
  { say: ['nfl'], mean: ['American Football'] },
  { say: ['gaelic'], mean: ['Gaelic Football'] },
  { say: ['rugby'], mean: ['Rugby Union', 'Rugby League'] },
  {
    say: ['run', 'running', 'runner', 'a run', 'go for a run', 'jog', 'jogging', 'parkrun', 'marathon', 'half marathon', '5k', '10k'],
    mean: ['Running', 'Athletics & XC']
  },
  { say: ['athletics', 'track and field', 'cross country', 'xc', 'sprinting'], mean: ['Athletics & XC', 'Running'] },
  { say: ['swim', 'swimming', 'swimmer', 'swimming pool', 'lengths'], mean: ['Swimming'] },
  { say: ['ping pong'], mean: ['Table Tennis'] },
  { say: ['frisbee', 'ultimate'], mean: ['Ultimate Frisbee'] },
  { say: ['horse riding', 'horse', 'riding', 'horses'], mean: ['Equestrian'] },
  { say: ['martial arts', 'martial art', 'self defence', 'self defense'], mean: ['Judo', 'Karate', 'Taekwondo', 'Jitsu', 'MMA', 'Muay Thai'] },
  { say: ['kickboxing', 'kick boxing', 'ufc'], mean: ['Muay Thai', 'Boxing', 'MMA'] },
  { say: ['jiu jitsu', 'jujitsu', 'ju jitsu', 'bjj'], mean: ['Jitsu'] },
  { say: ['cheer', 'cheerleader'], mean: ['Cheerleading'] },
  { say: ['tumbling'], mean: ['Gymnastics'] },
  {
    say: ['weightlifting', 'weight lifting', 'lifting', 'lifting weights', 'weights', 'strength training', 'bodybuilding', 'deadlift'],
    mean: ['Olympic Weightlifting', 'Powerlifting', 'Sport']
  },
  // "Not the gym" also rules out Pilates and Yoga: that's how students meant it in testing.
  { say: ['gym', 'gym society', 'the gym', 'gym membership'], mean: ['Sport', 'Olympic Weightlifting', 'Powerlifting', 'Pilates', 'Yoga'] },
  {
    say: ['get fit', 'getting fit', 'get fitter', 'fitter', 'fitness', 'keep fit', 'exercise', 'workout', 'working out', 'be more active', 'get active', 'stay active'],
    mean: ['Sport', 'Running', 'Pilates', 'Yoga', 'Walking', 'Cycling']
  },
  { say: ['pole dancing', 'pole fitness', 'pole'], mean: ['Pole Dance'] },
  { say: ['skating', 'figure skating', 'ice skate'], mean: ['Ice Skating'] },
  { say: ['ski', 'skiing', 'snowboard', 'snowboarding'], mean: ['Snow Sports'] },
  { say: ['surfing', 'surfer'], mean: ['Surf'] },
  { say: ['kayak', 'canoe', 'canoeing', 'paddling', 'paddleboarding', 'paddle boarding', 'paddleboard'], mean: ['Kayaking'] },
  { say: ['climbing', 'climb', 'climber', 'bouldering', 'boulder', 'rock climbing'], mean: ['Climbing', 'Outdoor Climbing', 'Mountaineering'] },
  { say: ['hiking', 'hike', 'hill walking', 'fell walking', 'rambling', 'walk', 'walks', 'long walk'], mean: ['Walking', 'Mountaineering'] },
  { say: ['outdoors', 'the outdoors', 'outdoor', 'camping', 'mountain', 'mountains', 'the hills'], mean: ['Walking', 'Mountaineering', 'Outdoor Climbing', 'Kayaking'] },
  { say: ['bike', 'biking', 'cycle', 'cyclist', 'bike ride', 'mountain biking'], mean: ['Cycling'] },
  { say: ['snooker', 'pool', 'billiards'], mean: ['Pool and Snooker'] },
  { say: ['stretching'], mean: ['Yoga', 'Pilates'] },
  { say: ['meditation', 'mindfulness'], mean: ['Yoga', 'Mental Wellbeing'] },
  { say: ['wrestling', 'wwe'], mean: ['Pro Wrestling'] },
  { say: ['formula 1', 'formula one', 'motorsport', 'motor racing', 'racing'], mean: ['F1', 'Formula Student'] },

  // ---------- Dancing, music and performing ----------
  { say: ['dancing', 'dancer', 'ballet', 'contemporary dance', 'jazz dance'], mean: ['Dance', 'Beats Cartel Dance', 'Salsa and Bachata', 'Bhangra', 'Irish Dance'] },
  { say: ['salsa', 'bachata', 'latin dance', 'latin dancing'], mean: ['Salsa and Bachata'] },
  { say: ['hip hop', 'street dance', 'commercial dance'], mean: ['Beats Cartel Dance', 'Dance'] },
  { say: ['irish dancing'], mean: ['Irish Dance'] },
  { say: ['live music', 'gig', 'gigs', 'concert', 'concerts', 'band', 'bands', 'seeing a band', 'indie band', 'festival', 'festivals'], mean: ['Gigs', 'Events', 'Music', 'Rock'] },
  { say: ['musician', 'instrument', 'guitar', 'piano', 'drums', 'drummer', 'singing', 'sing', 'choir', 'orchestra'], mean: ['Music', 'Musical Theatre'] },
  { say: ['rock music', 'metal', 'punk', 'emo', 'indie', 'alternative music'], mean: ['Rock', 'Gigs'] },
  { say: ['dj', 'djing', 'decks', 'techno', 'house music', 'drum and bass', 'dnb', 'electronic music', 'rave', 'raves', 'raving'], mean: ['Sync DJ', 'Events'] },
  { say: ['kpop', 'korean pop'], mean: ['K-Pop'] },
  { say: ['hatsune miku'], mean: ['Vocaloid'] },
  { say: ['theatre', 'acting', 'actor', 'plays', 'performing', 'stage'], mean: ['Drama', 'Musical Theatre'] },
  { say: ['musical', 'musicals'], mean: ['Musical Theatre'] },
  { say: ['poems', 'poem', 'spoken word', 'creative writing'], mean: ['Poetry', 'Creative Corridor'] },
  { say: ['drag queen', 'drag race'], mean: ['Drag'] },
  { say: ['anime', 'manga', 'costumes', 'comic con'], mean: ['Cosplay'] },
  { say: ['comics', 'comic', 'marvel', 'superheroes', 'graphic novels'], mean: ['Comic Book'] },

  // ---------- Films, art and making things ----------
  { say: ['film', 'films', 'movie', 'movies', 'cinema', 'the cinema', 'watching films'], mean: ['Film'] },
  { say: ['filmmaking', 'film making', 'making films', 'video production', 'tv production', 'directing', 'video editing'], mean: ['Film & TV Production', 'Film'] },
  { say: ['photography', 'photos', 'taking photos', 'camera'], mean: ['Art', 'Film & TV Production', 'Creative Corridor'] },
  { say: ['drawing', 'painting', 'sketching', 'illustration', 'arts and crafts', 'creative'], mean: ['Art', 'Creative Corridor'] },
  {
    say: ['knitting', 'knit', 'sewing', 'sew', 'embroidery', 'cross stitch', 'stitching', 'crafts', 'crafting', 'yarn', 'wool'],
    mean: ['Stitch, Make & Bitch', 'Hooked By Crochet']
  },
  { say: ['crochet', 'crocheting', 'amigurumi'], mean: ['Hooked By Crochet', 'Stitch, Make & Bitch'] },
  { say: ['clothes', 'modelling', 'modeling', 'catwalk'], mean: ['Fashion Show', 'Fashion'] },

  // ---------- Games and puzzles ----------
  {
    say: ['gaming', 'gamer', 'video games', 'video game', 'games console', 'playstation', 'xbox', 'nintendo', 'minecraft', 'fifa', 'fortnite', 'call of duty', 'pc gaming', 'online gaming', 'gaming online'],
    mean: ['Video Game', 'Esports', 'Gaming and Roleplay']
  },
  { say: ['competitive gaming', 'league of legends', 'valorant', 'counter strike', 'rocket league', 'e sports'], mean: ['Esports', 'Video Game'] },
  {
    say: ['board games', 'board game', 'tabletop', 'dungeons and dragons', 'd and d', 'dnd', 'warhammer', 'role playing', 'roleplay', 'rpg', 'card games', 'magic the gathering'],
    mean: ['Gaming and Roleplay', 'Chess']
  },

  // ---------- Reading, words and ideas ----------
  { say: ['reading', 'books', 'book club', 'novels', 'bookworm', 'reader'], mean: ['Book'] },
  { say: ['debating', 'debate', 'public speaking'], mean: ['Ottilie Debate', 'Model United Nations'] },
  { say: ['political', 'current affairs'], mean: ['Politics', 'Model United Nations'] },
  { say: ['socialism', 'socialist', 'left wing', 'marxism', 'trade union'], mean: ["Workers' Liberty"] },
  { say: ['model un', 'mun', 'united nations', 'international relations'], mean: ['Model United Nations'] },
  {
    say: ['languages', 'learn a language', 'learning a language', 'practise english', 'practice english', 'improve my english', 'japanese', 'spanish', 'french', 'german', 'mandarin', 'italian', 'arabic', 'korean language'],
    mean: ['Language Exchange']
  },
  { say: ['cats', 'cat', 'kittens'], mean: ['Cat Appreciation'] },
  { say: ['formula student', 'race car'], mean: ['Formula Student'] },
  { say: ['tech', 'technology', 'gadgets'], mean: ['Tech Connect', 'Computing'] },
  { say: ['artificial intelligence', 'machine learning', 'ai tools', 'building with ai'], mean: ['Claude Builder Club', 'Big Data & Data Science'] },

  // ---------- Going out, drinks and making friends ----------
  {
    say: ['nights out', 'night out', 'going out', 'clubbing', 'nightclub', 'nightclubs', 'party', 'parties', 'partying', 'big nights out', 'out with mates', 'out with friends'],
    mean: ['Events', 'Sync DJ', 'Dance', 'Habita', 'Beer']
  },
  { say: ['beer', 'real ale', 'craft beer', 'pub', 'pubs', 'drinks', 'drinking', 'a drink', 'pints', 'pint'], mean: ['Beer', 'Habita'] },
  { say: ['bar', 'student bar', 'the bar'], mean: ['Habita'] },
  { say: ['coffee', 'cafe', 'somewhere to study', 'study spot'], mean: ['Greenhouse Coffee'] },
  { say: ['whats on', 'things to do', 'something to do', 'socials', 'social events'], mean: ['Events'] },
  {
    say: ['make friends', 'making friends', 'meet people', 'meeting people', 'meet new people', 'new friends', 'socialise', 'socialising', 'social life'],
    mean: ['Events', 'Societies', 'Language Exchange'],
    need: true
  },
  {
    say: ['lonely', 'homesick', 'isolated', 'dont know anyone', 'no friends', 'stressed', 'stress', 'anxious', 'anxiety', 'overwhelmed', 'struggling', 'not coping', 'cant cope', 'feeling low', 'feeling down', 'mental health'],
    mean: ['Wellbeing', 'Mental Wellbeing', 'Events'],
    need: true
  },

  // ---------- Worries: money, food, housing and academic trouble (never advice: an NSU service) ----------
  {
    say: ['money for food', 'run out of money for food', 'ran out of money for food', 'running out of money for food', 'afford food', 'food bank', 'foodbank', 'no food', 'need food', 'hungry', 'afford to eat', 'run out of food', 'ran out of food', 'buy food', 'pay for food', 'skipping meals'],
    mean: ['Food Pantry', 'Cost of Living'],
    need: true
  },
  {
    say: ['money', 'loan', 'student loan', 'afford', 'broke', 'skint', 'bills', 'rent', 'cost of living', 'budget', 'budgeting', 'debt', 'overdraft', 'hardship', 'run out of money', 'ran out of money', 'running out of money'],
    mean: ['Cost of Living', 'Advice Centre'],
    need: true
  },
  { say: ['laptop', 'borrow a laptop', 'my laptop broke', 'no laptop', 'computer broke'], mean: ['Laptop Loan', 'Cost of Living'], need: true },
  {
    say: ['landlord', 'letting agent', 'damp', 'mould', 'mold', 'deposit', 'tenancy', 'housing', 'accommodation', 'repairs', 'where to live', 'house hunting', 'next years house'],
    mean: ['Advice Centre', 'Rate Your Landlord'],
    need: true
  },
  {
    say: ['plagiarism', 'academic misconduct', 'misconduct', 'cheating', 'accused', 'appeal', 'academic appeal', 'complaint', 'complain', 'unfair', 'disciplinary', 'discipline', 'fined', 'fitness to practise'],
    mean: ['Advice Centre'],
    need: true
  },

  // ---------- Getting involved ----------
  { say: ['volunteering', 'volunteer', 'charity', 'fundraising', 'give back', 'help others', 'helping people'], mean: ['Choose a Challenge', 'Litter Picking', 'MEDLIFE', 'Phab'] },
  { say: ['litter', 'clean up', 'environment', 'environmental', 'sustainability', 'sustainable', 'climate', 'eco', 'recycling'], mean: ['Green Impact', 'Litter Picking'] },
  { say: ['stem cell', 'stem cells', 'donor'], mean: ['Marrow'] },
  { say: ['course rep', 'student rep', 'have a say', 'campaign', 'campaigning'], mean: ['Student Voice'] },
  { say: ['student officers', 'sabbatical', 'sabbs', 'su president'], mean: ['SABB Team'] },
  { say: ['podcast', 'podcasting', 'radio', 'recording studio'], mean: ['The Studio'] },
  { say: ['job', 'jobs', 'part time job', 'part time work', 'work part time', 'earn money', 'earn some money', 'extra money'], mean: ['Jobs at NSU'] },
  { say: ['society', 'societies', 'join a society', 'clubs and societies'], mean: ['Societies'], weak: true },
  { say: ['students union', 'student union', 'nsu', 'the union'], mean: ['Contact NSU', 'All NSU services'], weak: true },
  { say: ['campus', 'campuses', 'city campus', 'coach lane'], mean: ['Campuses'], weak: true },
  { say: ['binding', 'first aid', 'mental health first aid'], mean: ['All NSU services'] },

  // ---------- Who they are: faith, culture and communities (some are only for people who say they are) ----------
  {
    say: ['christian', 'christianity', 'church', 'faith', 'jesus', 'bible', 'worship', 'prayer', 'praying', 'god'],
    mean: ['Christian Union', 'Hope Fellowship', 'Ablaze', 'PENSA', 'The Great Experience', 'Believers Love World']
  },
  { say: ['pentecostal'], mean: ['PENSA'] },
  { say: ['muslim', 'islam', 'mosque', 'prayer room', 'halal', 'ramadan', 'eid'], mean: ['Islamic'] },
  { say: ['ukraine'], mean: ['Ukrainian'] },
  { say: ['iraq'], mean: ['Iraqi'] },
  { say: ['kurdistan', 'kurd'], mean: ['Kurdish'] },
  { say: ['malaysia'], mean: ['Malaysian'] },
  { say: ['sri lanka'], mean: ['Sri Lankan'] },
  { say: ['sudan'], mean: ['Sudanese'] },
  { say: ['india'], mean: ['Indian'] },
  { say: ['nigeria'], mean: ['Nigerian'] },
  { say: ['pakistan'], mean: ['Pakistani'] },
  { say: ['saudi arabia'], mean: ['Saudi'] },
  { say: ['philippines', 'pinoy'], mean: ['Filipino'] },
  { say: ['kenya', 'kenyan', 'ethiopia', 'ethiopian', 'uganda', 'ugandan', 'tanzania', 'tanzanian', 'somalia', 'somali', 'rwanda', 'rwandan', 'eritrea', 'eritrean'], mean: ['East African'] },
  { say: ['lgbt', 'lgbtq', 'lgbtqia', 'gay', 'lesbian', 'bisexual', 'bi', 'queer', 'trans', 'transgender', 'non binary', 'pride'], mean: ['LGBTQ+'] },
  { say: ['neurodiverse', 'neurodivergent', 'autism', 'autistic', 'adhd', 'dyslexia', 'dyslexic', 'dyspraxia'], mean: ['Neurodiverse & Inclusive'] },
  { say: ['mature student', 'older student', 'older than most', 'a bit older'], mean: ['Mature Students'] },
  { say: ['carer', 'young carer', 'caring for'], mean: ['Student Carers'] },
  { say: ['masters', 'masters student', 'msc', 'ma student'], mean: ['Masters Society'] },
  { say: ['phd', 'postgraduate research', 'doctorate', 'research student'], mean: ['Postgraduate Research', 'Postgraduate Education Research'] },

  // ---------- Courses (the academic societies are usually open to anyone) ----------
  { say: ['accounting', 'accountancy', 'finance', 'economics', 'banking'], mean: ['Accountancy, Finance & Economics'] },
  { say: ['data science', 'big data', 'data analytics'], mean: ['Big Data & Data Science'] },
  { say: ['biomedical', 'biomedical science', 'biology'], mean: ['Biomed'] },
  { say: ['business', 'management', 'entrepreneur'], mean: ['Business', 'International Business Management'] },
  { say: ['early years', 'childhood', 'childcare'], mean: ['Childhood & Early Years Society'] },
  { say: ['media', 'journalism', 'public relations', 'communications'], mean: ['Communication'] },
  { say: ['computer science', 'programming', 'coding', 'software', 'software engineering', 'developer', 'web development'], mean: ['Computing', 'Tech Connect', 'Cybersecurity'] },
  { say: ['cyber', 'cyber security', 'ethical hacking', 'hacking'], mean: ['Cybersecurity', 'Computing'] },
  { say: ['criminology', 'sociology'], mean: ['Criminology & Sociology'] },
  { say: ['design', 'graphic design', 'creative industries', 'fine art'], mean: ['Design, Arts & Creative Industries', 'Art'] },
  { say: ['electronics', 'electronic engineering'], mean: ['Electrical Engineering'] },
  { say: ['engineering', 'engineer'], mean: ['Engineering, Physics & Maths', 'Civil Engineering', 'Electrical Engineering', 'Mechanical & Automotive Engineering', 'Formula Student'] },
  { say: ['physics', 'maths', 'mathematics'], mean: ['Engineering, Physics & Maths'] },
  { say: ['english literature', 'english language', 'literature'], mean: ['English', 'Book'] },
  { say: ['forensic', 'forensics'], mean: ['Forensic Science'] },
  { say: ['counselling', 'counsellor'], mean: ['Guidance & Counselling'] },
  { say: ['international business'], mean: ['International Business Management'] },
  { say: ['law', 'llb', 'solicitor', 'barrister', 'lawyer'], mean: ['Law', 'MARS (Mooting, Advocacy & Research Skills)'] },
  { say: ['mooting', 'advocacy'], mean: ['MARS (Mooting, Advocacy & Research Skills)'] },
  { say: ['mechanical engineering', 'automotive', 'cars'], mean: ['Mechanical & Automotive Engineering'] },
  { say: ['midwife'], mean: ['Midwifery'] },
  { say: ['nurse', 'nursing student'], mean: ['Nursing'] },
  { say: ['occupational therapist'], mean: ['Occupational Therapy'] },
  { say: ['odp'], mean: ['Operating Department Practice'] },
  { say: ['physiotherapy', 'physiotherapist'], mean: ['Physio'] },
  { say: ['teaching', 'teacher', 'primary teaching', 'education'], mean: ['Primary Education'] },
  { say: ['surveying', 'quantity surveyor'], mean: ['Quantity Surveying'] },
  { say: ['construction', 'building surveying', 'construction management'], mean: ['Northumbria Construct'] },
  { say: ['social worker'], mean: ['Social Work'] }
]);

/**
 * Names that don't count on their own, as students use the word for something else: "book an
 * appointment", "rock up". Their everyday words above still count ("reading", "rock music").
 */
export const NOT_BY_NAME = Object.freeze(['Book', 'Rock', 'Events', 'Campuses', 'Societies', 'Treb', 'Phab', 'Drag', 'No Plans?']);

/**
 * Phrases that mean nothing here, and stop a shorter phrase inside them counting: "run out of money"
 * isn't running, "not sure" isn't ruling anything out, "good food" isn't the Food Pantry, and "book an
 * appointment" isn't the Book society.
 */
export const NOTHING = Object.freeze([
  'run out', 'ran out', 'running out', 'running late', 'run late', 'rock up', 'not sure', 'not really sure', 'not too sure',
  'dont know', 'no idea', 'not yet', 'not now', 'no worries', 'no problem', 'not bad', 'not much', 'no thanks', 'no thank you',
  'dont mind', 'not at all', 'work out how', 'working out how', 'work out what', 'working out what', 'work out where',
  'good food', 'nice food', 'no plans yet', 'not long', 'no rush', 'meal plan', 'party popper', 'book a', 'book an',
  'book in', 'book my', 'book the', 'book onto', 'book on', 'book it', 'book one', 'book ticket', 'book tickets',
  // Asking, not ruling out (British English): "can you not check if there's a gym society?", "is
  // there not a chess club?". "Can you not suggest sport" still rules sport out: that's "please don't".
  'can you not check', 'can you not find', 'can you not look', 'can you not see', 'can you not search',
  'could you not check', 'could you not find', 'could you not look', 'could you not see', 'could you not search',
  'is there not', 'are there not', 'is there no', 'are there no', 'why not', 'or not', 'whether or not'
]);

/**
 * Words that rule out what follows, up to the end of the sentence or a "but": "Not sport.", "I'm not
 * into sport, clubbing or gaming", "I don't like loud nights out". Straight after one, a comma means
 * it's an answer ("No, I like football"), not ruling anything out.
 */
export const RULING_OUT = Object.freeze([
  'not', 'no', 'not into', 'not really', 'not really into', 'not a fan of', 'not a big fan of', 'nothing like',
  'dont like', 'dont really like', 'dont enjoy', 'dont really enjoy', 'dont want', 'dont fancy', 'dont do', 'dont really do',
  'do not like', 'hate', 'dislike', 'avoid', 'rather avoid', 'rather not', 'cant stand', 'anything but', 'without'
]);

/** Words that end ruling out, so what follows counts again: "I'm not Ukrainian, but I'd love to learn about it". */
export const RULING_OUT_ENDS = Object.freeze(['but', 'though', 'although', 'however', 'instead', 'except', 'apart from', 'more into', 'prefer']);
