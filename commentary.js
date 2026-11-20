import { gameConfig, saveGameConfig } from './config.js';
import { sound } from './assets/audio.js';

/**
 * Offline Pre-Written Broadcast Commentary Engine & Optional Web Speech Synthesizer (commentary.js)
 *
 * HARD CONSTRAINTS:
 * - 100% offline pre-written lines in English ('en'), Hindi in Devanagari ('hi'), and Hinglish ('hinglish').
 * - Zero AI calls, zero external APIs, zero network requests.
 * - Optional spoken commentary via window.speechSynthesis with silent fallback to text captions.
 */

export const COMMENTARY_LINES = {
  match_start: {
    en: [
      'Welcome to Box Cricket 3D! {teamA} take on {teamB} in a high-octane clash.',
      'Floodlights are blazing and the crowd is roaring as {teamA} face {teamB}!',
      'Players stride out to the middle! {batsman} takes guard facing {bowler}.',
      'Crackling atmosphere in the stadium today—{teamA} vs {teamB} is underway!'
    ],
    hi: [
      'बॉक्स क्रिकेट 3D में आपका स्वागत है! {teamA} और {teamB} के बीच रोमांचक मुकाबला शुरू।',
      'स्टेडियम में दर्शकों का जबरदस्त शोर! {batsman} क्रीज़ पर तैयार और {bowler} के हाथ में गेंद।',
      'रोशनी से जगमगाता मैदान और दोनों टीमें जीत के इरादे से उतर चुकी हैं!',
      'मैच की पहली गेंद के लिए मंच तैयार—{batsman} स्ट्राइक पर हैं।'
    ],
    hinglish: [
      'Swagat hai Box Cricket 3D mein! {teamA} vs {teamB} ka blockbuster muqabla shuru!',
      'Stadium khachakhach bhara hai aur mahaul ekdum electric! {batsman} strike par taiyaar.',
      'Kya match hone wala hai aaj! {bowler} haath mein ball leke run-up mark par.',
      'Pehli ball ka intezaar khatam—dekhte hain kaun maarta hai baazi!'
    ]
  },

  delivery_release: {
    en: [
      '{bowler} steams in and bowls a {delivery} at {speed} km/h.',
      'Here comes {bowler}—releases a {delivery} clocking {speed} km/h.',
      '{bowler} charges in, {delivery} delivered at {speed} km/h!',
      'Nice rhythm from {bowler}, sends down a {delivery} at {speed} km/h.'
    ],
    hi: [
      '{bowler} दौड़ते हुए आए और {speed} km/h की रफ़्तार से {delivery} डाली।',
      '{bowler} की शानदार लय, {speed} km/h पर {delivery} फेंकी।',
      'तेज़ रन-अप के साथ {bowler} ने डाली चकमा देती हुई {delivery}!',
      '{bowler} तैयार, और यह {speed} km/h की सटीक {delivery}।'
    ],
    hinglish: [
      '{bowler} daudte hue aaye aur {speed} km/h ki {delivery} daali!',
      'Tagda run-up {bowler} ka, {speed} km/h par {delivery} release ki.',
      'Dekhiye {bowler} ka wrist position—chaturai se {delivery} feki!',
      '{bowler} in action, {speed} km/h ki tez {delivery} seedha corridor mein.'
    ]
  },

  dot_ball: {
    en: [
      'Solidly defended by {batsman} right under the eyes. No run.',
      'Crisp punch into the infield, fielded cleanly at cover. Dot ball.',
      'Good tight line from {bowler}! {batsman} watches it closely and blocks.',
      'Straight to the fielder in the ring—pressure building with another dot ball.',
      'Soft hands from {batsman}, tapped back down the pitch. No run.'
    ],
    hi: [
      '{batsman} का मजबूत डिफेंस, गेंद सीधे फील्डर के पास—कोई रन नहीं।',
      '{bowler} की कसी हुई गेंदबाज़ी! डॉट बॉल के साथ दबाव बढ़ता हुआ।',
      'हल्के हाथों से खेला {batsman} ने, लेकिन रन की कोई गुंजाइश नहीं।',
      'सीधे इनफील्ड में खेला गया शॉट, शानदार फील्डिंग और कोई रन नहीं।'
    ],
    hinglish: [
      'Solid defense {batsman} ka! Seedha fielder ke haath mein, dot ball.',
      'Kamaal ki tight bowling {bowler} dwara, ek aur dot ball!',
      'Halke haath se block kiya {batsman} ne—run ka koi chance nahi.',
      'Fielder bilkul chaukanna! Gend roki aur dot ball ka pressure banaya.'
    ]
  },

  near_miss: {
    en: [
      'Ooh, beaten all ends up! That {delivery} missed the outside edge by a whisker!',
      'What a peach from {bowler}! Zipped past the bat at {speed} km/h!',
      'Play and a miss! {batsman} was completely squared up by that movement.',
      'So close to the edge! The wicketkeeper and slips go up in an agonizing ooh!'
    ],
    hi: [
      'ओह! बाल-बाल बचे {batsman}! गेंद बल्ले के बेहद करीब से निकल गई!',
      'क्या जादुई गेंद थी {bowler} की! {batsman} पूरी तरह चकमा खा गए!',
      'हवा में लहराती हुई गेंद और बल्ले का बाहरी किनारा छूने से रह गई!',
      'स्टेडियम में आह की आवाज़—बेहद करीब से निकली यह {delivery}!'
    ],
    hinglish: [
      'Ooooh! Baal-baal bache {batsman}! Outside edge ko miss karti hui nikli ball!',
      'Kya jaffa daala hai {bowler} ne! {batsman} ko hawa tak nahi lagi.',
      'Sharp movement off the pitch aur bat ko beat kar gayi yeh {delivery}!',
      'Keeper aur slips sar pakad ke reh gaye—itna close miss!'
    ]
  },

  single: {
    en: [
      'Nudged into the gap with soft hands—quick single taken by {batsman}!',
      'Smart rotation of strike! {batsman} works it away for one.',
      'Pushed out to the sweeper on the leg side for a comfortable single.',
      'Good calling between the wickets! They scamper through for a brisk run.'
    ],
    hi: [
      'गैप में हल्के से धकेला और तेज़ी से एक रन पूरा किया {batsman} ने!',
      'समझदारी से स्ट्राइक रोटेट की—आसानी से एक रन मिला।',
      'विकेटों के बीच बेहतरीन तालमेल, तेज़ी से दौड़कर एक रन चुराया।',
      'खाली जगह में खेलकर {batsman} ने खाता आगे बढ़ाया—एक रन।'
    ],
    hinglish: [
      'Halke haath se gap mein push kiya aur tezi se single chura liya!',
      'Smart cricket by {batsman}—strike rotate ki ek run ke saath.',
      'Dono batters ke beech badhiya calling, aaraam se single poora.',
      'Mid-on ke bagal se nikaal ke tezi se ek run bhaag liye!'
    ]
  },

  two_runs: {
    en: [
      'Driven firmly into the deep pocket—they push hard and come back for two!',
      'Great running between the wickets! {batsman} turns the first into a rapid brace.',
      'Placed into the wide outfield gap, two more added to the total!',
      'Sprint back for the second! Excellent fitness shown by {batsman}.'
    ],
    hi: [
      'गहरे गैप में शॉट और दोनों बल्लेबाज़ों ने दौड़कर दो रन पूरे किए!',
      'शानदार रनिंग बिटवीन द विकेट्स! पहले रन को तेज़ी से दूसरे में बदला।',
      'आउटफील्ड के खाली कोने में गेंद, {batsman} के खाते में दो और रन जुड़े।'
    ],
    hinglish: [
      'Deep gap mein place kiya aur cheetah ki raftaar se bhaag kar 2 runs poore!',
      'Shandaar running! Pehla run tezi se liya aur doosre ke liye wapas mud gaye.',
      'Fielder jab tak ball tak pahunche, {batsman} ne do runs bator liye!'
    ]
  },

  three_runs: {
    en: [
      'Timed superbly into the deep! The fielder hauls it in just inside the rope—three runs!',
      'All-run three! Brilliant hustle between the wickets from {batsman}.',
      'Stopped inches inside the boundary cushion, and the batters run three hard ones!'
    ],
    hi: [
      'बाउंड्री के ठीक पहले फील्डर ने गेंद रोकी, लेकिन तब तक दौड़कर तीन रन पूरे!',
      'गज़ब की फिटनेस! विकेटों के बीच दौड़कर तीन महत्वपूर्ण रन बटोरे।'
    ],
    hinglish: [
      'Boundary rope ke bilkul paas fielding, tab tak bhaag kar 3 runs le liye!',
      'Zabardast stamina! {batsman} ne daud-daud ke teen runs poore kiye.'
    ]
  },

  four: {
    en: [
      'CRACK! Glorious {shot} from {batsman}—races across the turf for FOUR!',
      'Threaded through the gap with surgical precision! One bounce and into the fence for FOUR!',
      'Sweet timing off the middle of the bat! No fielder on earth is stopping that FOUR!',
      'Shot of authority! {batsman} leans into the {shot} and sends it scorching to the boundary!',
      'Pure class from {batsman}! That {shot} bullets across the outfield carpet for FOUR!'
    ],
    hi: [
      'चौका! {batsman} के बल्ले से निकला लाजवाब {shot}—गेंद गोली की तरह बाउंड्री के पार!',
      'कमाल की टाइमिंग! फील्डरों के पास देखने के सिवा कोई चारा नहीं—शानदार चार रन!',
      'गैप को चीरता हुआ करारा शॉट! एक टप्पा खाकर गेंद सीमा रेखा के बाहर—चौका!',
      'बल्ले के बीचो-बीच लगी गेंद और सनसनाती हुई चार रनों के लिए निकल गई!'
    ],
    hinglish: [
      'CHAUKA! Kya kadak {shot} maara hai {batsman} ne—goli ki raftaar se 4 runs!',
      'Pure timing! Fielders bas dekhte reh gaye aur ball seedha boundary line ke paar!',
      'Gap dhoondh nikala {batsman} ne! Ekdum makkhan jaisa {shot} for FOUR!',
      'Sweet spot se nikli aawaz hi bata rahi thi—yeh rukne wali nahi hai, 4 runs!'
    ]
  },

  six: {
    en: [
      'MAXIMUM! {batsman} launches a monstrous {shot} deep into the night sky for SIX!',
      'OUT OF THE PARK! Clean swing of the blade and that ball is in the upper tier for SIX!',
      'HUGE HIT! {batsman} picked the {delivery} early and deposited it miles into the crowd!',
      'Boom! High, handsome, and way over the ropes—six runs of pure power from {batsman}!',
      'Stand and deliver! {batsman} unleashes a towering {shot} for a massive SIX!'
    ],
    hi: [
      'छक्का!! {batsman} का गगनचुंबी प्रहार—गेंद सीधे दर्शकों के बीच जा गिरी!',
      'लाजवाब ताकत और टाइमिंग का संगम! {shot} के साथ गेंद स्टेडियम की छत की ओर—6 रन!',
      'धमाकेदार शॉट! {bowler} की गेंद को {batsman} ने हवाई यात्रा पर भेज दिया—शानदार छक्का!',
      'बल्ला घुमाया और गेंद सीमा रेखा के बहुत ऊपर से पार—पूरे छह रन!'
    ],
    hinglish: [
      'CHHAKKA!! {batsman} ne ball ko taron ke shehar mein bhej diya—MASSIVE SIX!',
      'Udaa diya! Kya monster {shot} maara hai {batsman} ne, seedha stands mein 6 runs!',
      'Boom! Ball gayi hawa mein aur boundary ke bahar darshakon ke beech—SIXER!',
      'Full power, perfect timing! {bowler} bas mud ke dekhte reh gaye—6 runs!'
    ]
  },

  wicket_bowled: {
    en: [
      'BOWLED HIM! Timber! {bowler} crashes through the gate and sends the bails flying!',
      'CLEAN BOWLED! What a peach of a {delivery} from {bowler}—stumps cartwheeling!',
      'Knockout blow! {bowler} beats {batsman} for pace and movement to shatter the woodwork!'
    ],
    hi: [
      'बोल्ड!! गिल्लियां हवा में! {bowler} ने {batsman} के चारों खाने चित कर दिए!',
      'क्लीन बोल्ड! {bowler} की खतरनाक {delivery} ने स्टंप्स उखाड़ दिए!',
      'डंडे बिखर गए! {batsman} के पास इस जादुई गेंद का कोई जवाब नहीं था!'
    ],
    hinglish: [
      'CLEAN BOWLED!! Dande ukhade {bowler} ne—bails hawa mein ud gayi!',
      'TIMBER! Kya zabardast {delivery} daali {bowler} ne, {batsman} charon khane chit!',
      'Gilli udi! {bowler} ki is ball ka {batsman} ke paas koi jawab nahi tha!'
    ]
  },

  wicket_caught: {
    en: [
      'CAUGHT! Up goes the ball and {fielder} takes a safe catch under pressure! {batsman} is OUT!',
      'Edged and taken! Sharp reflex catch—{bowler} strikes to dismiss {batsman}!',
      'Mistimed into the air and pouched cleanly! Big breakthrough for {bowler}!'
    ],
    hi: [
      'कैच आउट! हवा में खड़ी हुई गेंद और सुरक्षित हाथों में समा गई! {batsman} को लौटना होगा।',
      'किनारा लगा और शानदार कैच! {bowler} ने दिलाई अपनी टीम को बड़ी सफलता!',
      'गलत टाइमिंग का खामियाजा—सीधे फील्डर के हाथों में कैच और विकेट गिरा!'
    ],
    hinglish: [
      'CAUGHT! Hawa mein khadi hui ball aur safe haathon mein catch! {batsman} OUT!',
      'Bada wicket! Mistime kar baithe {batsman} aur fielder ne koi galti nahi ki!',
      'Edge laga aur seedha haath mein! {bowler} celebrating with the team!'
    ]
  },

  wicket_lbw: {
    en: [
      'LBW! Pinned right in front of middle stump! The finger goes up immediately!',
      'Plumb in front! {bowler} traps {batsman} on the crease with a skiddy {delivery}!',
      'Huge appeal and given! That was crashing straight into the stumps—LBW!'
    ],
    hi: [
      'एलबीडब्ल्यू आउट! स्टंप्स के बिल्कुल सामने पैड पर लगी गेंद और अंपायर की उंगली उठी!',
      'कोई शक नहीं! {bowler} की तेज़ {delivery} ने {batsman} को क्रीज़ पर फंसा लिया!',
      'ज़ोरदार अपील और आउट! गेंद सीधे मिडिल स्टंप पर जा रही थी।'
    ],
    hinglish: [
      'LBW OUT! Bilkul stumps ke saamne pad par lagi aur umpire ki ungli khadi!',
      'Plumb in front! {bowler} ki skiddy {delivery} ne {batsman} ko phasa liya!',
      'Zordaar appeal aur OUT! Teeno dandon ke saamne pakde gaye {batsman}.'
    ]
  },

  wicket_runout: {
    en: [
      'RUN OUT! Rocket throw to the stumps and {batsman} is caught short of the crease!',
      'Direct pressure in the ring! Bails whipped off with the batter inches short—RUN OUT!',
      'Mix-up between the wickets and a bullet throw ends the innings of {batsman}!'
    ],
    hi: [
      'रन आउट!! चीते जैसी फुर्ती से थ्रो और बल्लेबाज़ क्रीज़ से बाहर रह गए!',
      'विकेटों के बीच गलतफहमी और स्टंप्स बिखर गए—बड़ा रन आउट!',
      'शानदार फील्डिंग और सटीक थ्रो! क्रीज़ में पहुंचने से पहले ही गिल्लियां उड़ा दीं!'
    ],
    hinglish: [
      'RUN OUT!! Bullet throw seedha stumps par aur batter crease se chhota reh gaya!',
      'Badi galti running mein! Keeper/bowler ne bails uda di—RUN OUT!',
      'Kamaal ka relay throw outfield se, {batsman} ko pavilion lautna padega!'
    ]
  },

  wicket_stumped: {
    en: [
      'STUMPED! Quick as lightning behind the stumps! {batsman} dragged a foot out and is gone!',
      'Beaten in flight and whipped off in a flash by the keeper! Brilliant stumping!'
    ],
    hi: [
      'स्टंप आउट! फ्लाइट में चकमा खाए {batsman} और विकेटकीपर ने बिजली की गति से बेल्स उड़ा दीं!',
      'क्रीज़ से बाहर निकले और कीपर ने पलक झपकते ही काम तमाम कर दिया!'
    ],
    hinglish: [
      'STUMPED! Keeper ke haath bijli se bhi tez—{batsman} crease ke bahar pakde gaye!',
      'Spin aur flight mein chakma khaye aur keeper ne palak jhapakte bails uda di!'
    ]
  },

  dropped_catch: {
    en: [
      'DROPPED! Oh no, that went straight in and popped out! {batsman} gets a massive life!',
      'Spilled in the field! {bowler} has hands on head as the crowd lets out a huge groan!',
      'Put down! Tough chance diving at full stretch, and {batsman} survives!'
    ],
    hi: [
      'कैच छूट गया!! ओह, हाथ में आकर छिटक गई गेंद! {batsman} को मिला बड़ा जीवनदान!',
      'अविश्वसनीय! आसान सा मौका गंवाया और {bowler} निराश होकर सिर पकड़ रहे हैं!',
      'पूरे स्टेडियम में आह की गूंज—डाइव लगाई लेकिन गेंद हाथ में टिकी नहीं!'
    ],
    hinglish: [
      'DROPPED!! Arre baap re, haath mein aaya hua catch tapak gaya! {batsman} ko mila life!',
      '{bowler} ko yakeen nahi ho raha! Itna bada mauka chhoot gaya field par!',
      'Catches win matches kehte hain, par yahan {batsman} bach nikle!'
    ]
  },

  wide_ball: {
    en: [
      'Wide signaled by the umpire! Way too far outside the tramline from {bowler}.',
      'Straying down the side—umpire stretches both arms for a Wide. Extra run added.'
    ],
    hi: [
      'वाइड बॉल! लाइन से भटके {bowler} और अंपायर ने दोनों हाथ फैलाए।',
      'काफी बाहर डाली गई गेंद—बल्लेबाज़ी टीम के खाते में एक अतिरिक्त रन।'
    ],
    hinglish: [
      'WIDE BALL! Line se bhatke {bowler}, umpire ke dono haath hawa mein.',
      'Tramline ke bahar nikli ball—muft ka ek extra run mila batting team ko.'
    ]
  },

  no_ball: {
    en: [
      'NO BALL! {bowler} has overstepped the popping crease—and that means a FREE HIT is coming up!',
      'Siren sounds for a No-Ball! Free Hit on the very next delivery for {batsman}!'
    ],
    hi: [
      'नो बॉल!! {bowler} का पैर क्रीज़ से बाहर और अगली गेंद होगी फ्री हिट!',
      'सायरन बजा! नो बॉल के साथ अब {batsman} को मिलेगी शानदार फ्री हिट!'
    ],
    hinglish: [
      'NO BALL!! Overstep kar gaye {bowler}—ab agli ball par milega FREE HIT!',
      'Bada tohfa {batsman} ke liye! Agli ball Free Hit hai, khul ke ghumao bat!'
    ]
  },

  milestone_50: {
    en: [
      'FIFTY UP! Raise the bat, {batsman}! A sparkling half-century under pressure!',
      'Milestone reached! {batsman} brings up a superb 50 to a standing ovation!'
    ],
    hi: [
      'अर्धशतक पूरा!! {batsman} ने बल्ला उठाकर दर्शकों का अभिवादन स्वीकार किया—शानदार 50 रन!',
      'कमाल की पारी! {batsman} ने पूरे किए अपने पचास रन!'
    ],
    hinglish: [
      'FIFTY FOR {batsman}!! Bat utha ke crowd ko salute—kya shandaar half-century hai!',
      'Pachaas run poore! {batsman} aaj alag hi form mein nazar aa rahe hain!'
    ]
  },

  milestone_100: {
    en: [
      'CENTURY!! Take a bow, {batsman}! An unforgettable hundred of the highest class!',
      'MAGNIFICENT HUNDRED! {batsman} helmets off, bat raised—100 runs of pure brilliance!'
    ],
    hi: [
      'शतक!! {batsman} की ऐतिहासिक पारी—पूरा स्टेडियम खड़े होकर तालियां बजा रहा है!',
      'लाजवाब 100 रन! {batsman} ने आज मैदान के हर कोने में शॉट्स लगाए हैं!'
    ],
    hinglish: [
      'SHATAK!! {batsman} ka lajawab CENTURY! Stadium mein har koi khade hoke taali baja raha hai!',
      '100 RUNS POORE! Kya masterclass innings kheli hai aaj {batsman} ne!'
    ]
  },

  chase_tension: {
    en: [
      'Down to the wire! {needRuns} needed from {needBalls} balls—every delivery is gold dust!',
      'Feel the tension in the stadium! {needRuns} runs required off {needBalls} balls!'
    ],
    hi: [
      'रोमांच अपने चरम पर! जीत के लिए {needBalls} गेंदों में {needRuns} रनों की ज़रूरत!',
      'धड़कनें तेज़! अब हर एक गेंद मैच का पासा पलट सकती है—{needBalls} में {needRuns} चाहिए!'
    ],
    hinglish: [
      'Dhadkanein tez! Ab {needBalls} balls mein {needRuns} runs chahiye—paisa vasool thriller!',
      'Match bilkul kaante ki takkar par! {needBalls} gendon mein {needRuns} ki dar-kar!'
    ]
  },

  match_end: {
    en: [
      'What a finish! {winner} seal the victory after a breathtaking contest!',
      'Handshake time in the middle! {winner} triumph in style!'
    ],
    hi: [
      'शानदार समापन! रोमांचक मुकाबले के बाद {winner} ने दर्ज की यादगार जीत!',
      'मैच समाप्त! {winner} के खिलाड़ियों और समर्थकों में जश्न का माहौल!'
    ],
    hinglish: [
      'Kya shandaar finish! {winner} ne jeet liya yeh dhamakedaar muqabla!',
      'Match khatam aur {winner} ka jashn shuru—kya kamaal ka cricket dekhne ko mila!'
    ]
  }
};

const HIGH_PRIORITY_EVENTS = new Set([
  'four',
  'six',
  'wicket_bowled',
  'wicket_caught',
  'wicket_lbw',
  'wicket_runout',
  'wicket_stumped',
  'dropped_catch',
  'milestone_50',
  'milestone_100',
  'no_ball',
  'match_start',
  'match_end'
]);

const NORMAL_PRIORITY_EVENTS = new Set([
  ...HIGH_PRIORITY_EVENTS,
  'near_miss',
  'two_runs',
  'three_runs',
  'wide_ball',
  'chase_tension'
]);

export const CLOUD_TV_VOICES = [
  {
    voiceURI: 'cloud:en-IN',
    name: 'Harsha / Ravi · Indian Broadcast (TV Cloud Voice)',
    lang: 'en-IN',
    tl: 'en-IN',
    isCloud: true
  },
  {
    voiceURI: 'cloud:hi-IN',
    name: 'Aakash / Vivek · Hindi Broadcast (TV Cloud Voice)',
    lang: 'hi-IN',
    tl: 'hi',
    isCloud: true
  },
  {
    voiceURI: 'cloud:en-AU',
    name: 'Richie / Mark · Australian Broadcast (TV Cloud Voice)',
    lang: 'en-AU',
    tl: 'en-AU',
    isCloud: true
  },
  {
    voiceURI: 'cloud:en-GB',
    name: 'Nasser / David · British Broadcast (TV Cloud Voice)',
    lang: 'en-GB',
    tl: 'en-GB',
    isCloud: true
  },
  {
    voiceURI: 'cloud:en-US',
    name: 'Ian / Danny · International Broadcast (TV Cloud Voice)',
    lang: 'en-US',
    tl: 'en-US',
    isCloud: true
  }
];

class CommentarySystem {
  constructor() {
    this.recentLines = [];
    this.maxRecent = 12;
    this.availableVoices = [];
    this.onCaptionCallback = null;
    this.lastSpokenMs = 0;

    this.initSpeechVoices();
  }

  initSpeechVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      const updateVoices = () => {
        try {
          this.availableVoices = window.speechSynthesis.getVoices() || [];
        } catch {
          this.availableVoices = [];
        }
      };
      updateVoices();
      if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = updateVoices;
      }

      // Unlock speechSynthesis & Web Audio on any user click/touch/remote key (including TV D-pad OK/Enter)
      const unlockSpeech = () => {
        try {
          sound.init();
          if (window.speechSynthesis && window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
          }
          updateVoices();
        } catch {}
      };
      window.addEventListener('pointerdown', unlockSpeech, { passive: true });
      window.addEventListener('keydown', unlockSpeech, { passive: true });
      window.addEventListener('touchstart', unlockSpeech, { passive: true });
    } catch {
      // Silently ignore if speechSynthesis is restricted
    }
  }

  getLocalVoicesForLanguage(lang = gameConfig.commentary.language) {
    if (!this.availableVoices || this.availableVoices.length === 0) {
      this.initSpeechVoices();
    }
    const wantHindi = lang === 'hi';
    const matching = this.availableVoices.filter((v) => {
      const l = String(v.lang || '').toLowerCase();
      if (wantHindi) return l.startsWith('hi') || l.includes('india') || l.startsWith('en-in');
      if (lang === 'hinglish') return l.startsWith('en-in') || l.startsWith('hi') || l.startsWith('en');
      return l.startsWith('en');
    });
    return matching.length > 0 ? matching : this.availableVoices;
  }

  /**
   * Returns selectable voices for the Settings dropdown:
   * Always includes the 5 built-in Cloud TV Broadcast Voices (so Smart TV browsers always have full voice options)
   * plus any local OS Web Speech API voices installed on the device.
   */
  getVoicesForLanguage(lang = gameConfig.commentary.language) {
    const localVoices = this.getLocalVoicesForLanguage(lang);
    return [...CLOUD_TV_VOICES, ...localVoices];
  }

  setSettings(partial = {}) {
    Object.assign(gameConfig.commentary, partial);
    if (typeof partial.volume === 'number') {
      gameConfig.audio.commentary = partial.volume;
    }
    saveGameConfig();
  }

  shouldTriggerForFrequency(eventType) {
    if (!gameConfig.commentary.enabled && !gameConfig.commentary.spoken) return false;
    const freq = gameConfig.commentary.frequency || 'normal';
    if (freq === 'minimal') {
      return HIGH_PRIORITY_EVENTS.has(eventType);
    }
    if (freq === 'normal') {
      if (NORMAL_PRIORITY_EVENTS.has(eventType)) return true;
      // In 'normal' mode, speak ~45% of routine singles/dots/deliveries so it's lively without spam
      return Math.random() < 0.45;
    }
    return true; // 'full'
  }

  /**
   * Formats a commentary line for `eventType` in the active commentary language
   * ('en' | 'hi' | 'hinglish'), updates captions (if enabled), and speaks audio (if spoken is enabled).
   */
  trigger(eventType, context = {}, force = false) {
    // Only trigger commentary during active gameplay (after user clicks Play Match), unless testing voice in Settings
    const app = typeof window !== 'undefined' ? window.__boxCricketApp : null;
    if (app && !app.matchPlayConfirmed && !context?.__testVoicePreview) {
      return null;
    }

    const captionsOn = Boolean(gameConfig.commentary.enabled);
    const spokenOn = Boolean(gameConfig.commentary.spoken);
    if (!captionsOn && !spokenOn) return null;
    if (!force && !this.shouldTriggerForFrequency(eventType)) return null;

    const lang = gameConfig.commentary.language || 'en';
    const bucket = COMMENTARY_LINES[eventType] || COMMENTARY_LINES.dot_ball;
    const pool = bucket[lang] || bucket.en || [];
    if (pool.length === 0) return null;

    // Pick a line not in recent history
    let candidates = pool.filter((template) => !this.recentLines.includes(template));
    if (candidates.length === 0) candidates = pool;
    const chosenTemplate = candidates[Math.floor(Math.random() * candidates.length)];

    this.recentLines.push(chosenTemplate);
    if (this.recentLines.length > this.maxRecent) {
      this.recentLines.shift();
    }

    const defaults = {
      batsman: 'Batter',
      bowler: 'Bowler',
      fielder: 'Fielder',
      teamA: 'Team A',
      teamB: 'Team B',
      winner: 'Winner',
      speed: '132',
      delivery: 'good length ball',
      shot: 'drive',
      runs: '0',
      balls: '0',
      needRuns: '12',
      needBalls: '6'
    };
    const merged = { ...defaults, ...context };
    const text = chosenTemplate.replace(/\{(\w+)\}/g, (_, key) =>
      merged[key] !== undefined && merged[key] !== null ? String(merged[key]) : ''
    );

    const isHighPriority = HIGH_PRIORITY_EVENTS.has(eventType);

    if (captionsOn && this.onCaptionCallback) {
      this.onCaptionCallback(text, eventType, isHighPriority);
    }

    if (spokenOn && !gameConfig.audio.muted) {
      this.speakLine(text, lang, isHighPriority, eventType);
    }

    return text;
  }

  speakLine(text, lang = 'en', interrupt = false, eventType = 'dot_ball') {
    if (typeof document !== 'undefined' && document.hidden) return;

    // Dynamic Broadcast Pacing: high-energy excitement on boundaries/wickets, analytical tone on dot balls
    const isMegaExcitement =
      eventType === 'six' ||
      eventType.startsWith('wicket_') ||
      eventType === 'hat_trick' ||
      eventType === 'milestone_100';
    const isBoundaryOrMilestone =
      isMegaExcitement || eventType === 'four' || eventType === 'milestone_50' || eventType === 'match_end';

    const baseRate = lang === 'hi' ? 1.03 : 1.06;
    const rate = isMegaExcitement ? baseRate + 0.08 : isBoundaryOrMilestone ? baseRate + 0.04 : baseRate;

    // Alternate between Play-by-Play commentator and Expert Analyst
    this.commentatorTurn = ((this.commentatorTurn || 0) + 1) % 2;

    const selectedURI = gameConfig.commentary.voiceURI || 'auto';
    const cloudVoice = CLOUD_TV_VOICES.find((v) => v.voiceURI === selectedURI);
    const localVoices = this.getLocalVoicesForLanguage(lang);
    const hasLocalSpeechEngine =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      Boolean(window.speechSynthesis) &&
      localVoices.length > 0;

    // Determine Cloud TTS language/accent code (alternates between two broadcast accents in 'auto' mode)
    const defaultCloudTl =
      lang === 'hi'
        ? 'hi'
        : lang === 'hinglish'
          ? 'en-IN'
          : this.commentatorTurn === 0
            ? 'en-IN'
            : 'en-GB';
    const cloudTl = cloudVoice ? cloudVoice.tl : defaultCloudTl;

    // Play broadcast commentary desk chime on the Web Audio commentary bus
    sound.playCommentaryVoiceCadence(text, interrupt, false);

    // On static hosts (GitHub Pages / Android TV WebView APK) there is no /api/tts backend;
    // prefer local Web Speech API whenever available, and never spam 404 network fetches!
    const hostName = typeof window !== 'undefined' ? String(window.location?.hostname || '') : '';
    const isStaticHost =
      hostName.endsWith('github.io') ||
      hostName === 'appassets.androidplatform.net' ||
      (typeof window !== 'undefined' && window.location?.protocol === 'file:');

    // If user explicitly picked a Cloud TV Broadcast Voice on a server-backed host OR local speech is missing:
    if ((!isStaticHost && cloudVoice) || !hasLocalSpeechEngine) {
      if (!interrupt && performance.now() - this.lastSpokenMs < 1300) return;
      this.lastSpokenMs = performance.now();
      if (!isStaticHost) {
        sound.playCloudTTSAudio(text, cloudTl, rate, interrupt);
      }
      return;
    }

    try {
      const synth = window.speechSynthesis;
      if (synth.paused) {
        synth.resume();
      }

      if (interrupt && synth.speaking) {
        synth.cancel();
      } else if (synth.speaking && performance.now() - this.lastSpokenMs < 1400) {
        return;
      }

      const utter = new SpeechSynthesisUtterance(text);
      const masterVol = gameConfig.audio.muted ? 0 : gameConfig.audio.master;
      const commVol = gameConfig.commentary.volume ?? gameConfig.audio.commentary ?? 0.85;
      utter.volume = Math.max(0, Math.min(1, masterVol * commVol));
      utter.rate = rate;

      const turnPitchOffset = this.commentatorTurn === 0 ? 0.0 : -0.05;
      utter.pitch = Math.max(
        0.82,
        Math.min(1.24, (isMegaExcitement ? 1.14 : isBoundaryOrMilestone ? 1.08 : 1.0) + turnPitchOffset)
      );
      utter.lang = lang === 'hi' ? 'hi-IN' : lang === 'hinglish' ? 'en-IN' : 'en-US';

      if (selectedURI !== 'auto') {
        const explicit = this.availableVoices.find((v) => v.voiceURI === selectedURI);
        if (explicit) utter.voice = explicit;
      } else if (localVoices.length > 0) {
        utter.voice = localVoices[this.commentatorTurn % localVoices.length];
      }

      let startedSpeaking = false;
      utter.onstart = () => {
        startedSpeaking = true;
      };
      utter.onerror = () => {
        if (!startedSpeaking) {
          sound.playCloudTTSAudio(text, cloudTl, rate, interrupt);
        }
      };

      // TV Browser Watchdog: if OS speechSynthesis silently stalls for >320ms without starting, play Cloud TV Voice!
      setTimeout(() => {
        if (!startedSpeaking && !gameConfig.audio.muted && gameConfig.commentary.spoken) {
          sound.playCloudTTSAudio(text, cloudTl, rate, interrupt);
        }
      }, 320);

      this.lastSpokenMs = performance.now();
      synth.speak(utter);
    } catch {
      sound.playCloudTTSAudio(text, cloudTl, rate, interrupt);
    }
  }

  stopSpeech() {
    sound.stopCloudTTSAudio();
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

export const commentary = new CommentarySystem();
