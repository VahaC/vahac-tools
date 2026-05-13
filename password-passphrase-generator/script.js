// Password & Passphrase Generator — pwg-
// Dependencies: none. Uses crypto.getRandomValues() exclusively.
// Wordlist: 2048 curated English words from /usr/share/dict/american-english
// Entropy formula: length * log2(charset_size) | word_count * log2(2048)

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Wordlist (2048 words = 11.0 bits/word)
  // ------------------------------------------------------------------
var PWG_WORDLIST = [
    'abhorred', 'abides', 'abjured', 'ablution', 'about', 'abscess', 'absented', 'absorb', 'abstract', 'absurder',
    'academic', 'acct', 'aches', 'acids', 'acrylics', 'adapting', 'adaptors', 'added', 'adequate', 'adjuncts',
    'adjust', 'adjutant', 'admirers', 'adulated', 'adverser', 'advisory', 'aeon', 'affairs', 'affirmed', 'affixes',
    'affray', 'agilely', 'agility', 'agitate', 'ago', 'aha', 'aired', 'airliner', 'airlines', 'airmen',
    'airspace', 'alas', 'albumen', 'aliens', 'alohas', 'altar', 'altered', 'aluminum', 'alumna', 'amateurs',
    'ameba', 'ameers', 'amen', 'amiably', 'amiss', 'amuse', 'anagrams', 'anapest', 'angering', 'animals',
    'animated', 'ankhs', 'anklet', 'anointed', 'anthems', 'anxiety', 'anxious', 'aortas', 'apogee', 'apostles',
    'appraise', 'apprizes', 'approach', 'apses', 'arboreal', 'archly', 'ardor', 'arduous', 'argon', 'arm',
    'armature', 'armchair', 'armoring', 'aroma', 'arrange', 'arrogant', 'arsenals', 'artery', 'ascended', 'asphalt',
    'aspiring', 'assault', 'assessed', 'asylums', 'atheism', 'atlas', 'attain', 'attorney', 'attract', 'audibles',
    'audios', 'auras', 'autistic', 'avatar', 'avers', 'avg', 'awake', 'awaking', 'awes', 'awoken',
    'azimuth', 'babushka', 'backings', 'backspin', 'bagel', 'baked', 'balds', 'balky', 'ballets', 'balloon',
    'baloney', 'banal', 'bandied', 'bandits', 'bane', 'banes', 'bank', 'banned', 'barbells', 'barmaids',
    'barney', 'barraged', 'barrio', 'basemen', 'bash', 'batching', 'batsmen', 'batted', 'bawls', 'beaks',
    'beautify', 'became', 'bedrooms', 'bedsides', 'bedsore', 'beehives', 'beeswax', 'befell', 'behest', 'behold',
    'beholds', 'belayed', 'bell', 'bellyful', 'beloved', 'bench', 'benched', 'bender', 'benzene', 'berm',
    'berried', 'berry', 'berrying', 'besots', 'besought', 'bestial', 'bewares', 'bicepses', 'bidder', 'biffed',
    'billings', 'binaries', 'bindings', 'bingo', 'bins', 'birthday', 'bitch', 'bitten', 'blabbing', 'bladder',
    'blame', 'blaming', 'blasted', 'blazers', 'blazing', 'bleary', 'bless', 'bloating', 'blogged', 'blogger',
    'blondest', 'blood', 'bloomer', 'blots', 'blowups', 'bluefish', 'bluffer', 'blurring', 'blurting', 'board',
    'boarder', 'boaster', 'bonging', 'boobing', 'boost', 'booze', 'border', 'bored', 'boredom', 'bosoms',
    'botches', 'bounties', 'bovines', 'bow', 'bracing', 'brackish', 'bract', 'brags', 'brandies', 'brat',
    'breech', 'breezy', 'brigade', 'brisks', 'broccoli', 'broiler', 'broilers', 'broncho', 'bruising', 'buckle',
    'bucksaws', 'budded', 'bugaboos', 'bugged', 'bugger', 'buggiest', 'bugs', 'builder', 'bulkier', 'bulldoze',
    'bulrush', 'bum', 'bumpiest', 'bungles', 'bur', 'burner', 'burning', 'burritos', 'busing', 'bust',
    'butcher', 'butchery', 'bygone', 'bywords', 'cactus', 'cagey', 'cahoots', 'caissons', 'cajoled', 'calcify',
    'calfskin', 'called', 'cambium', 'cambiums', 'campus', 'caning', 'cannoned', 'canoeing', 'cants', 'canyons',
    'capering', 'capsize', 'captains', 'caption', 'capture', 'carafe', 'carbines', 'cardiac', 'cardio', 'caresses',
    'cargo', 'carpal', 'carps', 'carted', 'cartel', 'casks', 'cassino', 'caste', 'castors', 'casuals',
    'casualty', 'catacomb', 'catchers', 'cathode', 'caucuses', 'caused', 'cavilled', 'cellular', 'cent', 'centers',
    'ceramics', 'chad', 'chairing', 'chairman', 'chalet', 'chamoix', 'champed', 'chapping', 'charades', 'cheaters',
    'cheeps', 'cheers', 'chem', 'chemical', 'chemist', 'cherub', 'chippers', 'chirps', 'chisels', 'choler',
    'choppier', 'chromed', 'chump', 'chunk', 'churl', 'churned', 'chutzpah', 'ciabatta', 'cinchona', 'citric',
    'civic', 'civics', 'civilian', 'clamming', 'clamored', 'clamp', 'clanged', 'clapped', 'clappers', 'clarions',
    'clashing', 'cleanups', 'cleaved', 'clefs', 'clement', 'client', 'climaxed', 'clitoral', 'clocking', 'closes',
    'closure', 'clucked', 'clunkier', 'coarsely', 'coating', 'coatings', 'coauthor', 'cocoa', 'codes', 'coils',
    'coin', 'coitus', 'coking', 'coldly', 'colloid', 'colloids', 'colluded', 'colonies', 'comedy', 'comfort',
    'coming', 'communes', 'competed', 'competes', 'compo', 'conclude', 'confab', 'confirms', 'conforms', 'congaing',
    'connect', 'connived', 'consents', 'consular', 'contours', 'contrive', 'contused', 'coolly', 'coopers', 'cooping',
    'cooties', 'copies', 'copings', 'copses', 'copycat', 'cordons', 'cornrows', 'corporal', 'cosies', 'cosine',
    'coup', 'coupled', 'courtesy', 'coveting', 'cow', 'cowbirds', 'crabbily', 'cracker', 'cradle', 'cramps',
    'crape', 'crapping', 'cravat', 'cravats', 'crave', 'crayolas', 'creative', 'creek', 'crepes', 'crests',
    'crevice', 'crewed', 'crisped', 'crouches', 'cruising', 'crumbier', 'crummier', 'cubists', 'cuddlier', 'cudgeled',
    'cueing', 'culottes', 'culvert', 'culverts', 'cupfuls', 'cupsful', 'curate', 'curator', 'curators', 'curdle',
    'curlers', 'curlew', 'current', 'cybersex', 'cymbal', 'cynosure', 'cysts', 'dab', 'dabbling', 'dacha',
    'daddy', 'daffiest', 'dais', 'damming', 'dancer', 'dances', 'daring', 'dazing', 'deacons', 'deadwood',
    'deans', 'death', 'debarked', 'debaters', 'decade', 'decamps', 'decants', 'deckhand', 'declaims', 'decoding',
    'decreed', 'decries', 'defeats', 'defect', 'defy', 'degraded', 'deiced', 'deli', 'delicate', 'delight',
    'delimits', 'delivers', 'demented', 'dementia', 'demigod', 'demising', 'denature', 'denier', 'denims', 'denude',
    'denudes', 'deposit', 'derail', 'derogate', 'deserts', 'designed', 'desirous', 'despots', 'detonate', 'deuces',
    'device', 'deviled', 'diabolic', 'dialing', 'diaries', 'dieting', 'diets', 'diggers', 'dignify', 'diked',
    'dingo', 'dinner', 'diocesan', 'directer', 'dirt', 'disband', 'disclose', 'discs', 'discuses', 'discuss',
    'dish', 'dispense', 'disputes', 'distract', 'dittos', 'diuretic', 'dived', 'divorce', 'djinns', 'docketed',
    'document', 'doggy', 'doings', 'dolled', 'dolphins', 'dons', 'donut', 'doors', 'dorms', 'dotty',
    'doubles', 'doubly', 'dowdier', 'downier', 'dowsed', 'dozed', 'dozing', 'draft', 'dragon', 'draining',
    'dramatic', 'dreaming', 'dreamy', 'dregs', 'drink', 'dripped', 'drivings', 'droning', 'drown', 'ducat',
    'duchess', 'duct', 'duelists', 'dully', 'dumpling', 'dunks', 'duos', 'dwell', 'dwells', 'dyeing',
    'dynamic', 'earlobe', 'earthing', 'easy', 'eats', 'echelon', 'ecliptic', 'ecstatic', 'edger', 'edgiest',
    'educable', 'effects', 'eggheads', 'eject', 'elapsing', 'elastic', 'elated', 'elders', 'electors', 'elevens',
    'embeds', 'embodies', 'embossed', 'emphases', 'emu', 'emulsion', 'enameled', 'encamp', 'endowed', 'endued',
    'enfold', 'engaging', 'enjoys', 'enough', 'enslaves', 'envelops', 'enzyme', 'episodes', 'epistles', 'epitaph',
    'equips', 'eroded', 'erotics', 'essayed', 'ester', 'etched', 'ethic', 'evenly', 'eventful', 'excl',
    'exemplar', 'exempts', 'exhumes', 'exigency', 'exiles', 'exits', 'expends', 'expiated', 'extant', 'exterior',
    'extracts', 'extras', 'exuding', 'exulted', 'eye', 'eyefuls', 'eyetooth', 'facades', 'fairways', 'faiths',
    'famished', 'farming', 'fart', 'fast', 'fated', 'fathers', 'fats', 'fatty', 'faulted', 'faults',
    'feature', 'features', 'felon', 'felt', 'feminist', 'fending', 'fervent', 'fervidly', 'fetlock', 'fibers',
    'fifes', 'fifteens', 'fifths', 'fighting', 'filler', 'fillip', 'finalist', 'finals', 'fines', 'finessed',
    'finesses', 'finite', 'finking', 'fins', 'firearm', 'firebug', 'fishier', 'fixable', 'flags', 'flame',
    'flan', 'flattens', 'flecked', 'fleshier', 'flippy', 'floater', 'flock', 'flooder', 'flour', 'flow',
    'flunkeys', 'flunky', 'flute', 'fluting', 'flyover', 'flywheel', 'foals', 'focused', 'foe', 'foible',
    'folksy', 'fond', 'forage', 'forcibly', 'fords', 'foremost', 'forename', 'forestry', 'forests', 'forges',
    'formally', 'formats', 'forward', 'fourth', 'foxes', 'fractal', 'frayed', 'freeload', 'freest', 'frenzy',
    'fried', 'fringed', 'fryers', 'fucker', 'fuddle', 'fuels', 'fumbling', 'fungous', 'funking', 'funky',
    'furnaces', 'fussed', 'futz', 'gabbled', 'galaxy', 'gallery', 'gallium', 'gangland', 'ganglier', 'gangways',
    'garage', 'garaged', 'garbanzo', 'garble', 'gardener', 'gargled', 'garrison', 'gauged', 'gauging', 'geezers',
    'geishas', 'gel', 'gelatine', 'generic', 'genetics', 'genially', 'gets', 'gewgaw', 'ghostly', 'gild',
    'gillions', 'gipsies', 'girdled', 'glances', 'glare', 'glibness', 'gliders', 'glistens', 'gloomy', 'glossies',
    'glummer', 'glutted', 'gnawed', 'goad', 'goals', 'god', 'godchild', 'gods', 'goitre', 'goitres',
    'goldfish', 'golfers', 'goosed', 'gorse', 'grabs', 'graders', 'grass', 'grassy', 'grater', 'gravels',
    'greeting', 'greyish', 'grimed', 'grimes', 'grimiest', 'gringos', 'grit', 'groggier', 'grooving', 'grouse',
    'grovel', 'growls', 'gruff', 'guard', 'guffaws', 'gumdrops', 'gusto', 'gutless', 'guzzler', 'gyrated',
    'haggler', 'hailed', 'hall', 'halved', 'halving', 'hamming', 'hammocks', 'handout', 'happen', 'harbors',
    'harpoon', 'harrowed', 'hart', 'hassle', 'hastiest', 'hater', 'hawker', 'hawkers', 'hayseed', 'hazes',
    'hazings', 'heap', 'hearths', 'heaters', 'heating', 'heaves', 'hector', 'hedging', 'helmets', 'herbs',
    'herders', 'heresies', 'hes', 'hibachi', 'hiccough', 'hickeys', 'hicks', 'hie', 'hings', 'hint',
    'hip', 'hoarsely', 'hog', 'holdout', 'holdups', 'holly', 'homemade', 'hones', 'hook', 'hooked',
    'hookup', 'hoorah', 'hordes', 'hormones', 'horology', 'horseman', 'host', 'hostage', 'hovel', 'hubbubs',
    'hubs', 'huddle', 'humane', 'humaner', 'humid', 'humidity', 'humps', 'hungrier', 'hungry', 'hurdler',
    'hurrahs', 'hurt', 'hussar', 'hustled', 'huts', 'hutzpa', 'hymned', 'hysteric', 'icecaps', 'idler',
    'ids', 'iffy', 'iii', 'ikon', 'ilks', 'immense', 'impeding', 'impends', 'impetus', 'implore',
    'improves', 'impugns', 'incenses', 'incs', 'incubus', 'infants', 'informs', 'infuse', 'initial', 'injury',
    'inkblots', 'inkier', 'inkling', 'inkwell', 'innuendo', 'input', 'inquire', 'inscribe', 'insetted', 'inspired',
    'int', 'interact', 'intern', 'interne', 'inveigh', 'invited', 'inwardly', 'ionizes', 'ire', 'isolates',
    'itemized', 'jabot', 'jacket', 'jailing', 'jailors', 'jammed', 'jars', 'jaunt', 'jawboned', 'jay',
    'jeer', 'jellies', 'jerkin', 'jesters', 'jests', 'jettison', 'jibbed', 'jibbing', 'joggled', 'jollity',
    'jolts', 'jonquil', 'jots', 'judging', 'judo', 'jugulars', 'juicier', 'juleps', 'jumpier', 'jumps',
    'juniper', 'justness', 'keep', 'kidder', 'killers', 'kilned', 'kilning', 'kingdoms', 'kiss', 'kitchens',
    'kite', 'kitschy', 'kneed', 'kneel', 'knowable', 'kopek', 'lacier', 'lacy', 'ladies', 'ladings',
    'lager', 'lambaste', 'lamely', 'lamprey', 'lapping', 'laps', 'larceny', 'largesse', 'lark', 'larynxes',
    'lastly', 'laths', 'laudable', 'laughed', 'laughs', 'lavished', 'laxative', 'leafing', 'league', 'leakages',
    'leas', 'lecture', 'leery', 'leeway', 'legals', 'lemony', 'leniency', 'lentil', 'lesser', 'levitate',
    'lewdly', 'licorice', 'lid', 'liftoffs', 'light', 'likely', 'limber', 'limes', 'linesman', 'linkages',
    'linseed', 'lints', 'lionizes', 'liquor', 'liveable', 'liveware', 'llama', 'loafs', 'loaves', 'lobbing',
    'lobby', 'local', 'locale', 'lodes', 'lodestar', 'lofts', 'loges', 'logged', 'logging', 'logs',
    'looked', 'loonies', 'loony', 'loosened', 'lousiest', 'loveless', 'loyaller', 'lubing', 'lug', 'lugging',
    'lumpier', 'luridly', 'lustre', 'lymph', 'lyrical', 'macaroni', 'madrasah', 'maestros', 'magic', 'magma',
    'mailing', 'maizes', 'majesty', 'majors', 'malady', 'mamas', 'mamboed', 'mamboing', 'manage', 'mangers',
    'manliest', 'manna', 'manures', 'mapper', 'maps', 'marauder', 'market', 'marrieds', 'marrow', 'martin',
    'mashup', 'mason', 'masonic', 'massive', 'matching', 'maul', 'maxed', 'maximize', 'meander', 'meantime',
    'mechanic', 'medias', 'melding', 'member', 'memo', 'meshing', 'metals', 'methods', 'metric', 'mewling',
    'miaowing', 'midwifed', 'milder', 'militia', 'minaret', 'mined', 'minutes', 'miscue', 'mislaid', 'misogyny',
    'missal', 'misspend', 'mistrust', 'mizzens', 'mnemonic', 'moaning', 'mobbed', 'mobs', 'modicums', 'moieties',
    'molded', 'moneyed', 'mongers', 'mono', 'monocle', 'monsters', 'moray', 'mossier', 'mother', 'motor',
    'motoring', 'mousiest', 'mouth', 'mower', 'muezzin', 'muffing', 'muffling', 'mugs', 'murals', 'musts',
    'mutiny', 'mynahes', 'mynas', 'mystical', 'mystify', 'myth', 'nabbing', 'nabobs', 'nacre', 'naive',
    'narwhal', 'navy', 'nearest', 'necking', 'needled', 'negating', 'negligs', 'netters', 'nettles', 'newsier',
    'nibbled', 'nibbler', 'nicety', 'nigh', 'nodular', 'noels', 'nominees', 'none', 'nonrigid', 'nonsense',
    'nonuser', 'nonusers', 'notarize', 'notches', 'notching', 'nothings', 'noughts', 'nth', 'nullify', 'numbest',
    'numeracy', 'nurtured', 'oasis', 'objector', 'obstacle', 'obtains', 'obtuse', 'obviates', 'occupied', 'ocean',
    'oceanic', 'oddest', 'odors', 'offense', 'ogles', 'oil', 'okaying', 'olden', 'omit', 'omnibus',
    'oncoming', 'onyx', 'ooze', 'oozing', 'ops', 'optima', 'optimum', 'orates', 'orbit', 'orchid',
    'ordering', 'orients', 'osier', 'outranks', 'outvoted', 'ovations', 'over', 'overawed', 'overbore', 'overcast',
    'overcome', 'overgrow', 'overstep', 'overtly', 'owlish', 'oxfords', 'oxidizes', 'pacific', 'pacing', 'padlocks',
    'padres', 'pagans', 'painless', 'paleness', 'palette', 'paltry', 'pampas', 'paneling', 'panier', 'paniers',
    'panned', 'panorama', 'pantries', 'parkas', 'parlays', 'parley', 'parlors', 'parole', 'paroling', 'parroted',
    'parse', 'pass', 'pasterns', 'pasts', 'patois', 'paupers', 'pavement', 'pawpaw', 'peaches', 'peahen',
    'pecked', 'peers', 'peeved', 'pekoe', 'pellet', 'pelleted', 'pencils', 'pension', 'pensions', 'penury',
    'peopling', 'pepping', 'perfects', 'perjurer', 'perking', 'person', 'perter', 'pervades', 'petunia', 'pharaohs',
    'phishers', 'phlox', 'phobic', 'phonics', 'phosphor', 'phrased', 'piccolos', 'picker', 'picketed', 'pidgins',
    'pigged', 'pinafore', 'pining', 'pinning', 'pippin', 'pithy', 'pizazz', 'placards', 'placid', 'placing',
    'plaited', 'planed', 'planking', 'planned', 'planning', 'planted', 'planter', 'plastics', 'platelet', 'plates',
    'pleading', 'pleads', 'plethora', 'plight', 'plugging', 'plugins', 'plums', 'plus', 'pluses', 'podiatry',
    'poignant', 'point', 'polarity', 'poles', 'polices', 'pomading', 'pommels', 'pond', 'pooched', 'poorest',
    'poppy', 'portage', 'porticos', 'potful', 'potions', 'potpies', 'pouching', 'pounding', 'pouting', 'powered',
    'powers', 'prairie', 'pram', 'prattles', 'preach', 'prefects', 'preludes', 'pressed', 'prestos', 'presumed',
    'prim', 'pristine', 'privets', 'profane', 'profess', 'prolong', 'prompter', 'prongs', 'proper', 'propping',
    'protons', 'prows', 'proxy', 'prudery', 'puberty', 'puddled', 'puffing', 'punt', 'pupa', 'puppy',
    'purifies', 'purl', 'purling', 'pursuer', 'pussycat', 'putted', 'qua', 'quack', 'quarter', 'query',
    'quibbler', 'quieted', 'quines', 'quisling', 'quoth', 'rabid', 'racer', 'raffle', 'raided', 'rake',
    'ranchers', 'rancor', 'random', 'ranking', 'ranting', 'rapidity', 'ratified', 'rattler', 'rattles', 'reaction',
    'reads', 'readying', 'realized', 'reassure', 'rebels', 'recalled', 'receives', 'recorded', 'rectors', 'recycled',
    'reddened', 'redrew', 'reelects', 'referral', 'refiners', 'reforest', 'refutes', 'regaling', 'regexp', 'regimen',
    'regions', 'reigning', 'relaid', 'related', 'relearns', 'reliant', 'remained', 'remark', 'remedy', 'reminder',
    'renal', 'reneging', 'renewed', 'reorder', 'repaid', 'repaints', 'repair', 'repays', 'repeats', 'replayed',
    'replete', 'repleted', 'requital', 'rescued', 'resents', 'restock', 'restored', 'retailed', 'retainer', 'retaken',
    'reticent', 'retires', 'retorted', 'retrains', 'retries', 'retweets', 'retyped', 'revenged', 'reversal', 'revise',
    'revived', 'revokes', 'revving', 'reward', 'rewires', 'rhyming', 'rhythms', 'rice', 'rickets', 'ridden',
    'rides', 'riding', 'righter', 'rigid', 'rimming', 'ripened', 'rises', 'ritziest', 'riveters', 'roadbed',
    'roaring', 'robbery', 'robust', 'rogers', 'roguery', 'rolling', 'rooftops', 'roomers', 'rosier', 'rotary',
    'rotates', 'rotating', 'roughest', 'roughly', 'route', 'roves', 'rowelled', 'ruggeder', 'rum', 'rumbaing',
    'rummage', 'rumple', 'rundown', 'runway', 'sadden', 'saddest', 'saddle', 'sadism', 'sagacity', 'sago',
    'saintly', 'salaamed', 'saline', 'sallow', 'salved', 'salves', 'sampans', 'sampled', 'sandier', 'sandwich',
    'saplings', 'satiates', 'satyr', 'savant', 'savorier', 'savoring', 'scad', 'scales', 'scansion', 'scant',
    'scarves', 'scent', 'scenting', 'scepters', 'schema', 'schemer', 'schmucks', 'sciences', 'scion', 'sconces',
    'screech', 'scrod', 'scrods', 'scruffs', 'sculled', 'scurry', 'scuzzy', 'seacoast', 'sealant', 'seashore',
    'seasons', 'secrets', 'secure', 'sedates', 'sellout', 'selvages', 'semen', 'senator', 'sensual', 'sepals',
    'serer', 'serpent', 'setbacks', 'settle', 'settled', 'sevenths', 'severing', 'sexists', 'sextant', 'shade',
    'shallow', 'shaming', 'shark', 'sharpest', 'shavers', 'shavings', 'shaykhs', 'sheathes', 'shifty', 'shined',
    'shinned', 'shitty', 'shleps', 'shots', 'showdown', 'shrewd', 'shrikes', 'shrilled', 'shrouded', 'shticks',
    'shunt', 'shunts', 'shush', 'shuttle', 'sidewall', 'sidles', 'sidling', 'siege', 'sieges', 'sigh',
    'sighted', 'signal', 'signers', 'silence', 'silents', 'sim', 'simplex', 'since', 'singing', 'sinners',
    'sired', 'sitars', 'site', 'sitters', 'sixty', 'sized', 'skein', 'skewered', 'skirted', 'skivvy',
    'skunked', 'slackers', 'slake', 'slaked', 'slapping', 'slather', 'sleds', 'sleek', 'slicks', 'sliding',
    'sliest', 'slighted', 'slinking', 'slithers', 'slits', 'slued', 'slumdogs', 'slurring', 'slyly', 'smartly',
    'smear', 'smirches', 'smurfs', 'snack', 'snacking', 'snacks', 'snarls', 'sneak', 'sneaking', 'snippy',
    'snooker', 'snorted', 'snowed', 'snowfall', 'snug', 'soapiest', 'soaping', 'soar', 'soberly', 'sofa',
    'soggiest', 'solve', 'solvent', 'solving', 'somehow', 'sonny', 'sorrows', 'souse', 'soybean', 'spaces',
    'spammed', 'spanking', 'spanks', 'spares', 'spasm', 'spawned', 'speckle', 'spent', 'spewing', 'sphinx',
    'spinoff', 'spited', 'splays', 'spleen', 'spline', 'spools', 'spoors', 'sportier', 'spot', 'spouted',
    'sprat', 'sprouts', 'spurned', 'spurt', 'sputter', 'sputters', 'squab', 'squads', 'squalled', 'squirt',
    'stags', 'staining', 'stalked', 'stalling', 'standbys', 'starch', 'starlet', 'startups', 'state', 'steady',
    'steamer', 'steer', 'steps', 'sternest', 'stills', 'stints', 'stirrer', 'stirrers', 'stoking', 'stomachs',
    'stooped', 'stores', 'stouter', 'straps', 'striven', 'strokes', 'strumpet', 'studly', 'styes', 'stymie',
    'suaver', 'subbed', 'subhead', 'suborn', 'subpoena', 'suburbia', 'sued', 'suffice', 'sulfide', 'sulkier',
    'sulking', 'sultan', 'sundown', 'sunning', 'sunroof', 'supple', 'supplier', 'surfeits', 'surges', 'surnames',
    'surveyor', 'svelte', 'sveltest', 'swagging', 'swanked', 'swatting', 'swelter', 'swim', 'swishes', 'swops',
    'swords', 'sybarite', 'synagog', 'syntax', 'tabbies', 'table', 'tabled', 'tabooed', 'tailing', 'talks',
    'talons', 'tamely', 'tamers', 'tangy', 'tapestry', 'tapeworm', 'tarried', 'tartly', 'task', 'taxable',
    'taxed', 'taxied', 'taxpayer', 'tealight', 'teased', 'teemed', 'tells', 'temblors', 'tempo', 'tenderly',
    'tends', 'tenured', 'terraced', 'testates', 'tests', 'tethered', 'textiles', 'theater', 'theaters', 'theatres',
    'thee', 'them', 'theme', 'themes', 'theorems', 'thieving', 'thongs', 'thous', 'threaten', 'thrive',
    'throve', 'throw', 'thrower', 'thugs', 'thymuses', 'tick', 'ticks', 'tidied', 'tight', 'tile',
    'tiled', 'timidest', 'tinseled', 'tinsels', 'tipsier', 'titan', 'tizzy', 'toast', 'toastier', 'toasty',
    'toffees', 'toiling', 'toilsome', 'tolerate', 'tomahawk', 'tome', 'toniest', 'tony', 'tossing', 'tot',
    'toucan', 'touch', 'toughens', 'tour', 'tourneys', 'tout', 'towel', 'traffic', 'tragic', 'traitors',
    'trawl', 'trawler', 'trawls', 'treading', 'treadle', 'treadles', 'treating', 'tree', 'trends', 'triceps',
    'trilled', 'tripped', 'tritely', 'trod', 'trolling', 'trotters', 'troubled', 'trounce', 'troweled', 'troy',
    'troys', 'truce', 'trusting', 'trysting', 'tsunami', 'tufts', 'tuition', 'tumblers', 'tumbrils', 'tummies',
    'tumults', 'turbans', 'turbot', 'turnips', 'turnkey', 'turnoffs', 'turtle', 'twaddle', 'tweets', 'twerks',
    'twiddles', 'twiggier', 'twinks', 'twisters', 'typos', 'ultimate', 'umiak', 'umlaut', 'unafraid', 'unbend',
    'underpay', 'unfurled', 'unguents', 'unhook', 'unnerved', 'unpaid', 'unpick', 'unquote', 'unread', 'unripe',
    'unruly', 'unsalted', 'unsaying', 'unsays', 'unsteady', 'untidy', 'untold', 'unwanted', 'unwarier', 'upbraids',
    'uplands', 'uplifted', 'upload', 'upraised', 'urchins', 'urged', 'useless', 'usury', 'vampires', 'vanity',
    'vapes', 'varlet', 'varying', 'vats', 'vegan', 'venal', 'vender', 'verbose', 'vex', 'victory',
    'vim', 'vineyard', 'virulent', 'virus', 'visages', 'visaing', 'vised', 'visors', 'vital', 'vividest',
    'vocation', 'vowel', 'vowels', 'waddles', 'waded', 'wafts', 'wager', 'waggles', 'wagon', 'wagoners',
    'wails', 'waivers', 'wale', 'walker', 'walkways', 'wall', 'walls', 'wanking', 'wannest', 'wantonly',
    'warbler', 'warfare', 'warily', 'warthogs', 'watchdog', 'watchmen', 'waving', 'weasels', 'wed', 'weekly',
    'weepy', 'weevils', 'weighing', 'wheat', 'whens', 'whets', 'whimsey', 'whimsies', 'whipping', 'whirs',
    'whisk', 'whispers', 'whys', 'widest', 'wife', 'wigwams', 'wild', 'wildcat', 'wildfire', 'willful',
    'wincing', 'wine', 'wingspan', 'winks', 'winners', 'wiry', 'wishful', 'witches', 'wive', 'wobbling',
    'wooded', 'woodwork', 'wooed', 'woolens', 'woozier', 'workouts', 'worlds', 'worse', 'worst', 'wrangle',
    'wrangles', 'wretch', 'wretches', 'writable', 'writers', 'writes', 'writing', 'xiii', 'xviii', 'xxxii',
    'yam', 'yammer', 'yammers', 'yaps', 'yea', 'years', 'yeasts', 'yeasty', 'yeshivot', 'yocks',
    'yogis', 'yuck', 'yummier', 'yuppy', 'zappers', 'zens', 'zero', 'zippered'
  ];
  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  var CHARS_UPPER   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var CHARS_LOWER   = 'abcdefghijklmnopqrstuvwxyz';
  var CHARS_DIGITS  = '0123456789';
  var CHARS_SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?~';
  var AMBIGUOUS     = 'lI1O0oB8S5Z2';

  var BITS_PER_WORD = Math.log2(PWG_WORDLIST.length); // 11.0 for 2048 words

  // ------------------------------------------------------------------
  // Utility: $ shorthand
  // ------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------
  // Crypto random helpers
  // ------------------------------------------------------------------

  /**
   * Returns a cryptographically secure random integer in [0, max)
   */
  function randomInt(max) {
    var arr = new Uint32Array(1);
    var limit = Math.floor(0x100000000 / max) * max;
    do {
      crypto.getRandomValues(arr);
    } while (arr[0] >= limit);
    return arr[0] % max;
  }

  /**
   * Returns a random element from an array
   */
  function randomPick(arr) {
    return arr[randomInt(arr.length)];
  }

  // ------------------------------------------------------------------
  // Entropy helpers
  // ------------------------------------------------------------------
  function calcPasswordEntropy(length, charsetSize) {
    if (charsetSize < 2 || length < 1) return 0;
    return length * Math.log2(charsetSize);
  }

  function calcPhraseEntropy(wordCount) {
    return wordCount * BITS_PER_WORD;
  }

  function strengthClass(bits) {
    if (bits < 50) return 'weak';
    if (bits < 80) return 'fair';
    if (bits < 110) return 'strong';
    return 'best';
  }

  function strengthLabel(bits) {
    if (bits < 50) return '🔴 Weak';
    if (bits < 80) return '🟡 Fair';
    if (bits < 110) return '🟢 Strong';
    return '💎 Very Strong';
  }

  // meter fills at 128 bits max visually
  function meterWidth(bits) {
    return Math.min(100, (bits / 128) * 100).toFixed(1) + '%';
  }

  function updateEntropyDisplay(bits, valueId, strengthId, meterId) {
    var valueEl    = $(valueId);
    var strengthEl = $(strengthId);
    var meterEl    = $(meterId);
    var cls        = strengthClass(bits);

    valueEl.textContent = bits.toFixed(1) + ' bits';

    strengthEl.textContent = strengthLabel(bits);
    strengthEl.className = 'pwg-entropy-strength pwg-s-' + cls;

    meterEl.style.width = meterWidth(bits);
    meterEl.className = 'pwg-meter-fill pwg-m-' + cls;
  }

  // ------------------------------------------------------------------
  // Build charset for password
  // ------------------------------------------------------------------
  function buildCharset() {
    var charset = '';
    if ($('pwg-use-upper').checked)   charset += CHARS_UPPER;
    if ($('pwg-use-lower').checked)   charset += CHARS_LOWER;
    if ($('pwg-use-digits').checked)  charset += CHARS_DIGITS;
    if ($('pwg-use-symbols').checked) charset += CHARS_SYMBOLS;

    if ($('pwg-excl-ambig').checked) {
      var clean = '';
      for (var i = 0; i < charset.length; i++) {
        if (AMBIGUOUS.indexOf(charset[i]) === -1) clean += charset[i];
      }
      charset = clean;
    }
    return charset;
  }

  // ------------------------------------------------------------------
  // Generate one password
  // ------------------------------------------------------------------
  function generatePassword() {
    var length  = parseInt($('pwg-length-range').value, 10);
    var charset = buildCharset();

    if (charset.length < 2) {
      showError('pwg-pass-error', 'Select at least one character set.');
      return null;
    }
    hideError('pwg-pass-error');

    var password = '';
    for (var i = 0; i < length; i++) {
      password += charset[randomInt(charset.length)];
    }
    return { text: password, entropy: calcPasswordEntropy(length, charset.length) };
  }

  // ------------------------------------------------------------------
  // Generate passphrase
  // ------------------------------------------------------------------
  function generatePassphrase() {
    var wordCount  = parseInt($('pwg-words-range').value, 10);
    var sep        = document.querySelector('input[name="pwg-sep"]:checked').value;
    var capitalize = $('pwg-capitalize').checked;
    var addNum     = $('pwg-add-number').checked;

    var words = [];
    for (var i = 0; i < wordCount; i++) {
      var word = PWG_WORDLIST[randomInt(PWG_WORDLIST.length)];
      if (capitalize) word = word.charAt(0).toUpperCase() + word.slice(1);
      words.push(word);
    }

    var phrase = words.join(sep);
    if (addNum) {
      phrase += sep + randomInt(100);
    }

    var entropy = calcPhraseEntropy(wordCount);
    if (addNum) entropy += Math.log2(100); // ~6.6 bits
    return { text: phrase, entropy: entropy };
  }

  // ------------------------------------------------------------------
  // UI: show / hide error
  // ------------------------------------------------------------------
  function showError(id, msg) {
    var el = $(id);
    el.textContent = msg;
    el.classList.add('pwg-visible');
  }

  function hideError(id) {
    var el = $(id);
    el.textContent = '';
    el.classList.remove('pwg-visible');
  }

  // ------------------------------------------------------------------
  // Public: Generate password (single)
  // ------------------------------------------------------------------
  function genPassword() {
    var result = generatePassword();
    if (!result) return;
    $('pwg-password-output').textContent = result.text;
    updateEntropyDisplay(result.entropy, 'pwg-pass-entropy', 'pwg-pass-strength', 'pwg-pass-meter');
    $('pwg-batch-out').innerHTML = '';
  }

  // ------------------------------------------------------------------
  // Public: Generate x5
  // ------------------------------------------------------------------
  function genMultiple() {
    var first = generatePassword();
    if (!first) return;
    $('pwg-password-output').textContent = first.text;
    updateEntropyDisplay(first.entropy, 'pwg-pass-entropy', 'pwg-pass-strength', 'pwg-pass-meter');

    var batchEl = $('pwg-batch-out');
    batchEl.innerHTML = '';

    for (var i = 0; i < 4; i++) {
      var result = generatePassword();
      if (!result) break;
      var item = document.createElement('div');
      item.className = 'pwg-batch-item';
      item.innerHTML = '<span>' + escapeHtml(result.text) + '</span><span class="pwg-batch-item-copy">click to copy</span>';
      (function (text) {
        item.addEventListener('click', function () { copyText(text); });
      })(result.text);
      batchEl.appendChild(item);
    }
  }

  // ------------------------------------------------------------------
  // Public: Generate phrase
  // ------------------------------------------------------------------
  function genPhrase() {
    var result = generatePassphrase();
    $('pwg-phrase-output').textContent = result.text;
    updateEntropyDisplay(result.entropy, 'pwg-phrase-entropy', 'pwg-phrase-strength', 'pwg-phrase-meter');
  }

  // ------------------------------------------------------------------
  // Public: Tab switching
  // ------------------------------------------------------------------
  function switchTab(name) {
    var tabs   = ['password', 'passphrase'];
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      $('pwg-tab-' + t).classList.toggle('pwg-tab--active', t === name);
      $('pwg-panel-' + t).classList.toggle('pwg-panel--hidden', t !== name);
    }
  }

  // ------------------------------------------------------------------
  // Copy helpers
  // ------------------------------------------------------------------
  function copyText(text) {
    if (!text || text === 'Click Generate') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showToast).catch(fallbackCopy.bind(null, text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); showToast(); } catch (e) {}
    document.body.removeChild(ta);
  }

  function copyPassword() {
    copyText($('pwg-password-output').textContent);
  }

  function copyPhrase() {
    copyText($('pwg-phrase-output').textContent);
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  var toastTimer = null;
  function showToast() {
    var t = $('pwg-toast');
    t.classList.add('pwg-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('pwg-show'); }, 2000);
  }

  // ------------------------------------------------------------------
  // Slider sync
  // ------------------------------------------------------------------
  function syncLength(val) {
    val = Math.max(4, Math.min(128, parseInt(val, 10) || 4));
    $('pwg-length-range').value = val;
    $('pwg-length-num').value = val;
    $('pwg-length-display').textContent = val;
  }

  function syncLengthNum(val) {
    syncLength(val);
    genPassword();
  }

  function syncWords(val) {
    val = Math.max(2, Math.min(12, parseInt(val, 10) || 2));
    $('pwg-words-range').value = val;
    $('pwg-words-num').value = val;
    $('pwg-words-display').textContent = val;
  }

  function syncWordsNum(val) {
    syncWords(val);
    genPhrase();
  }

  // ------------------------------------------------------------------
  // Escape HTML
  // ------------------------------------------------------------------
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------------
  // Keyboard: Enter on length input triggers gen
  // ------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', function () {
    var lenNum = $('pwg-length-num');
    if (lenNum) {
      lenNum.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') genPassword();
      });
    }
    var wordsNum = $('pwg-words-num');
    if (wordsNum) {
      wordsNum.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') genPhrase();
      });
    }
    // Auto-generate on load
    genPassword();
  });

  // ------------------------------------------------------------------
  // Expose to HTML onclick handlers
  // ------------------------------------------------------------------
  window.pwgGenPassword  = genPassword;
  window.pwgGenMultiple  = genMultiple;
  window.pwgGenPhrase    = genPhrase;
  window.pwgSwitchTab    = switchTab;
  window.pwgCopyPassword = copyPassword;
  window.pwgCopyPhrase   = copyPhrase;
  window.pwgSyncLength   = syncLength;
  window.pwgSyncLengthNum = syncLengthNum;
  window.pwgSyncWords    = syncWords;
  window.pwgSyncWordsNum = syncWordsNum;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      PWG_WORDLIST: PWG_WORDLIST,
      CHARS_UPPER: CHARS_UPPER,
      CHARS_LOWER: CHARS_LOWER,
      CHARS_DIGITS: CHARS_DIGITS,
      CHARS_SYMBOLS: CHARS_SYMBOLS,
      AMBIGUOUS: AMBIGUOUS,
      BITS_PER_WORD: BITS_PER_WORD,
      randomInt: randomInt,
      calcPasswordEntropy: calcPasswordEntropy,
      calcPhraseEntropy: calcPhraseEntropy,
      strengthClass: strengthClass,
      strengthLabel: strengthLabel,
      meterWidth: meterWidth
    };
  }

})();
