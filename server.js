require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); 
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const multer = require('multer');
const FormData = require('form-data');
const upload = multer();  

const app = express();
app.disable('etag');
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* ---------------------------------------------------------
   Telegram Loan Notify Function
--------------------------------------------------------- */
async function sendLoanToTelegram(text, photos = []) {
  const token = process.env.LOAN_TELEGRAM_BOT_TOKEN;
  const chats = (process.env.LOAN_TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);

  if (!token || chats.length === 0) {
    console.error('❌ Loan Telegram bot not configured');
    return;
  }

  for (const chatId of chats) {
    try {
      // 先发文字
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: chatId,
          text,
          parse_mode: 'HTML'
        },
        { timeout: 10000 }
      );

      // 再发图片
      for (const photo of photos) {
        if (!photo) continue;

        const fd = new FormData();
        fd.append('chat_id', chatId);
        fd.append('photo', photo.buffer, {
          filename: photo.originalname || 'loan.jpg'
        });

        await axios.post(
          `https://api.telegram.org/bot${token}/sendPhoto`,
          fd,
          { headers: fd.getHeaders(), timeout: 15000 }
        );
      }

    } catch (err) {
      console.error(`Telegram loan send error for chat ${chatId}:`, err.response?.data || err.message);
    }
  }
}

/* --------------------- Global safety handlers --------------------- */
process.on('unhandledRejection', (reason, p) => {
  console.error('UNHANDLED REJECTION at: Promise', p, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION', err);
});
// 生成 2FA 密钥和二维码
app.post('/api/admin/generate-2fa', async (req, res) => {
  const { adminId } = req.body;  // 获取管理员ID

  if (!adminId) {
    return res.status(400).json({ ok: false, message: '管理员账号不能为空' });
  }

  // 生成 2FA 密钥
  const secret = speakeasy.generateSecret({ name: `NEXBIT 管理后台 - ${adminId}` });

  // 使用二维码生成库生成二维码 URL
  qrcode.toDataURL(secret.otpauth_url, function (err, qr_code) {
    if (err) {
      return res.status(500).json({ ok: false, message: '二维码生成失败' });
    }

    // 将密钥存储到数据库，方便后续验证
    // 示例：await db.ref(`admins/${adminId}/2fa_secret`).set(secret.base32);

    // 返回生成的二维码和密钥
    res.json({
      ok: true,
      qr_code: qr_code,  // 二维码链接
      secret: secret.base32 // 2FA 密钥
    });
  });
});

// 验证 2FA 验证码
app.post('/api/admin/verify-2fa', async (req, res) => {
  const { adminId, code } = req.body;

  if (!adminId || !code) {
    return res.status(400).json({ ok: false, message: '管理员账号和验证码不能为空' });
  }

  // 从数据库获取管理员的 2FA 密钥（此处为假设，实际使用时需从数据库读取）
  // 例如：const secret = await db.ref(`admins/${adminId}/2fa_secret`).once('value');
  const secret = '你的2FA密钥';  // 这里需要替换为从数据库中获取的密钥

  // 使用 speakeasy 库验证验证码
  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: code
  });

  if (verified) {
    return res.json({ ok: true, message: '2FA 验证成功' });
  } else {
    return res.status(400).json({ ok: false, message: '验证码错误' });
  }
});

/* ---------------------------------------------------------
   Recovery Phrase APIs
--------------------------------------------------------- */
const crypto = require('crypto');

const BIP39_WORDS_SERVER = [
  'abandon','ability','able','about','above','absent','absorb','abstract','absurd','abuse','access','accident','account','accuse','achieve','acid','acoustic','acquire','across','act','action','actor','actress','actual','adapt','add','addict','address','adjust','admit','adult','advance','advice','aerobic','affair','afford','afraid','africa','after','again','age','agent','agree','ahead','aim','air','airport','aisle','alarm','album','alcohol','alert','alien','all','alley','allow','almost','alone','alpha','already','also','alter','always','amateur','amazing','among','amount','amused','analyst','anchor','ancient','anger','angle','angry','animal','ankle','announce','annual','another','answer','antenna','antique','anxiety','any','apart','apology','appear','apple','approve','april','arch','arctic','area','arena','argue','arm','armed','armor','army','around','arrange','arrest','arrive','arrow','art','artefact','artist','artwork','ask','aspect','assault','asset','assist','assume','asthma','athlete','atom','attack','attend','attitude','attract','auction','audit','august','aunt','author','auto','autumn','average','avocado','avoid','awake','aware','away','awesome','awful','awkward','axis',
  'baby','bachelor','bacon','badge','bag','balance','balcony','ball','bamboo','banana','banner','bar','barely','bargain','barrel','base','basic','basket','battle','beach','bean','beauty','because','become','beef','before','begin','behave','behind','believe','below','belt','bench','benefit','best','betray','better','between','beyond','bicycle','bid','bike','bind','biology','bird','birth','bitter','black','blade','blame','blanket','blast','bleak','bless','blind','blood','blossom','blouse','blue','blur','blush','board','boat','body','boil','bomb','bone','bonus','book','boost','border','boring','borrow','boss','bottom','bounce','box','boy','bracket','brain','brand','brass','brave','bread','breeze','brick','bridge','brief','bright','bring','brisk','broccoli','broken','bronze','broom','brother','brown','brush','bubble','buddy','budget','buffalo','build','bulb','bulk','bullet','bundle','bunker','burden','burger','burst','bus','business','busy','butter','buyer','buzz',
  'cabbage','cabin','cable','cactus','cage','cake','call','calm','camera','camp','can','canal','cancel','candy','cannon','canoe','canvas','canyon','capable','capital','captain','car','carbon','card','cargo','carpet','carry','cart','case','cash','casino','castle','casual','cat','catalog','catch','category','cattle','caught','cause','caution','cave','ceiling','celery','cement','census','century','cereal','certain','chair','chalk','champion','change','chaos','chapter','charge','chase','chat','cheap','check','cheese','chef','cherry','chest','chicken','chief','child','chimney','choice','choose','chronic','chuckle','chunk','churn','cigar','cinnamon','circle','citizen','city','civil','claim','clap','clarify','claw','clay','clean','clerk','clever','click','client','cliff','climb','clinic','clip','clock','clog','close','cloth','cloud','clown','club','clump','cluster','clutch','coach','coast','coconut','code','coffee','coil','coin','collect','color','column','combine','come','comfort','comic','common','company','concert','conduct','confirm','congress','connect','consider','control','convince','cook','cool','copper','copy','coral','core','corn','correct','cost','cotton','couch','country','couple','course','cousin','cover','coyote','crack','cradle','craft','cram','crane','crash','crater','crawl','crazy','cream','credit','creek','crew','cricket','crime','crisp','critic','crop','cross','crouch','crowd','crucial','cruel','cruise','crumble','crunch','crush','cry','crystal','cube','culture','cup','cupboard','curious','current','curtain','curve','cushion','custom','cute','cycle',
  'dad','damage','damp','dance','danger','daring','dash','daughter','dawn','day','deal','debate','debris','decade','december','decide','decline','decorate','decrease','deer','defense','define','defy','degree','delay','deliver','demand','demise','denial','dentist','deny','depart','depend','deposit','depth','deputy','derive','describe','desert','design','desk','despair','destroy','detail','detect','develop','device','devote','diagram','dial','diamond','diary','dice','diesel','diet','differ','digital','dignity','dilemma','dinner','dinosaur','direct','dirt','disagree','discover','disease','dish','dismiss','disorder','display','distance','divert','divide','divorce','dizzy','doctor','document','dog','doll','dolphin','domain','donate','donkey','donor','door','dose','double','dove','draft','dragon','drama','drastic','draw','dream','dress','drift','drill','drink','drip','drive','drop','drum','dry','duck','dumb','dune','during','dust','dutch','duty','dwarf','dynamic',
  'eager','eagle','early','earn','earth','easily','east','easy','echo','ecology','economy','edge','edit','educate','effort','egg','eight','either','elbow','elder','electric','elegant','element','elephant','elevator','elite','else','embark','embody','embrace','emerge','emotion','employ','empower','empty','enable','enact','end','endless','endorse','enemy','energy','enforce','engage','engine','enhance','enjoy','enlist','enough','enrich','enroll','ensure','enter','entire','entry','envelope','episode','equal','equip','era','erase','erode','erosion','error','erupt','escape','essay','essence','estate','eternal','ethics','evidence','evil','evoke','evolve','exact','example','excess','exchange','excite','exclude','excuse','execute','exercise','exhaust','exhibit','exile','exist','exit','exotic','expand','expect','expire','explain','expose','express','extend','extra','eye','eyebrow',
  'fabric','face','faculty','fade','faint','faith','fall','false','fame','family','famous','fan','fancy','fantasy','farm','fashion','fat','fatal','father','fatigue','fault','favorite','feature','february','federal','fee','feed','feel','female','fence','festival','fetch','fever','few','fiber','fiction','field','figure','file','film','filter','final','find','fine','finger','finish','fire','firm','first','fiscal','fish','fit','fitness','fix','flag','flame','flash','flat','flavor','flee','flight','flip','float','flock','floor','flower','fluid','flush','fly','foam','focus','fog','foil','fold','follow','food','foot','force','forest','forget','fork','fortune','forum','forward','fossil','foster','found','fox','fragile','frame','frequent','fresh','friend','fringe','frog','front','frost','frown','frozen','fruit','fuel','fun','funny','furnace','fury','future',
  'gadget','gain','galaxy','gallery','game','gap','garage','garbage','garden','garlic','garment','gas','gasp','gate','gather','gauge','gaze','general','genius','genre','gentle','genuine','gesture','ghost','giant','gift','giggle','ginger','giraffe','girl','give','glad','glance','glare','glass','glide','glimpse','globe','gloom','glory','glove','glow','glue','goat','goddess','gold','good','goose','gorilla','gospel','gossip','govern','gown','grab','grace','grain','grant','grape','grass','gravity','great','green','grid','grief','grit','grocery','group','grow','grunt','guard','guess','guide','guilt','guitar','gun','gym',
  'habit','hair','half','hammer','hamster','hand','happy','harbor','hard','harsh','harvest','hat','have','hawk','hazard','head','health','heart','heavy','hedgehog','height','hello','helmet','help','hen','hero','hidden','high','hill','hint','hip','hire','history','hobby','hockey','hold','hole','holiday','hollow','home','honey','hood','hope','horn','horror','horse','hospital','host','hotel','hour','hover','hub','huge','human','humble','humor','hundred','hunt','hurdle','hurry','hurt','husband','hybrid',
  'ice','icon','idea','identify','idle','ignore','ill','illegal','illness','image','imitate','immense','immune','impact','impose','improve','impulse','inch','include','income','increase','index','indicate','indoor','industry','infant','inflict','inform','inhale','inherit','initial','inject','injury','inmate','inner','innocent','input','inquiry','insane','insect','inside','inspire','install','intact','interest','into','invest','invite','iron','island','isolate','issue','item','ivory',
  'jacket','jaguar','jar','jazz','jealous','jeans','jelly','jewel','job','join','joke','journey','joy','judge','juice','jump','jungle','junior','junk','just','justice',
  'kangaroo','keen','keep','ketchup','key','kick','kid','kidney','kind','kingdom','kiss','kit','kitchen','kite','kitten','kiwi','knee','knife','knock','know',
  'lab','label','labor','ladder','lady','lake','lamp','language','laptop','large','later','latin','laugh','laundry','lava','law','lawn','lawsuit','layer','lazy','leader','leaf','learn','leave','lecture','left','leg','legal','legend','leisure','lemon','lend','length','lens','leopard','lesson','letter','level','liar','liberty','library','license','life','lift','light','like','limb','limit','link','lion','liquid','list','little','live','lizard','load','loan','lobster','local','lock','logic','lonely','long','loop','lottery','loud','lounge','love','loyal','lucky','luggage','lunar','lunch','lyrics',
  'machine','mad','magic','magnet','maid','mail','main','major','mama','man','manage','maneuver','mango','mansion','mantle','manual','maple','marble','march','margin','marine','market','marriage','mask','mass','master','match','material','math','matrix','matter','maximum','maze','meadow','mean','measure','meat','mechanic','medal','media','melody','melt','member','memory','mention','menu','mercy','merge','merit','merry','mesh','message','metal','method','middle','midnight','milk','million','mimic','mind','minimum','minor','minute','miracle','mirror','misery','miss','mistake','mix','mixed','mixture','mobile','model','modify','mom','moment','monitor','monkey','monster','month','moon','moral','more','morning','mosquito','mother','motion','motor','mountain','mouse','move','movie','much','muffin','mule','multiply','muscle','museum','mushroom','music','must','mutual','myself','mystery',
  'naive','name','napkin','narrow','nasty','nation','nature','near','neck','need','negative','neglect','neither','nephew','nerve','nest','net','network','neutral','never','news','next','nice','night','noble','noise','nominee','noodle','normal','north','nose','notable','note','nothing','notice','novel','now','nuclear','number','nurse','nut','oak','obey','object','oblige','obscure','observe','obtain','obvious','occur','ocean','october','odor','off','offer','office','often','oil','okay','old','olive','olympic','omit','once','one','onion','online','only','open','opera','opinion','oppose','option','orange','orbit','orchard','order','ordinary','organ','orient','original','orphan','ostrich','other','outdoor','outer','output','outside','oval','oven','over','own','owner','oxygen','oyster','ozone',
  'pact','paddle','page','pair','palace','palm','panda','panel','panic','panther','paper','parade','parent','park','parrot','party','pass','patch','path','patient','patrol','pattern','pause','pave','payment','peace','peanut','pear','peasant','pelican','pen','penalty','pencil','people','pepper','perfect','permit','person','pet','phone','photo','phrase','physical','piano','picnic','picture','piece','pig','pigeon','pill','pilot','pink','pioneer','pipe','pistol','pitch','pizza','place','planet','plastic','plate','play','please','pledge','pluck','plug','plunge','poem','poet','point','polar','pole','police','pond','pony','pool','popular','portion','position','possible','post','potato','pottery','poverty','powder','power','practice','praise','predict','prefer','prepare','present','pretty','prevent','price','pride','primary','print','priority','prison','private','prize','problem','process','produce','profit','program','project','promote','proof','property','prosper','protect','proud','provide','public','pudding','pull','pulp','pulse','pumpkin','punch','pupil','puppy','purchase','purity','purpose','purse','push','put','puzzle',
  'pyramid','quality','quantum','quarter','question','quick','quit','quiz','quote','rabbit','raccoon','race','rack','radar','radio','rail','rain','raise','rally','ramp','ranch','random','range','rapid','rare','rate','rather','raven','raw','razor','ready','real','reason','rebel','rebuild','recall','receive','recipe','record','recycle','reduce','reflect','reform','refuse','region','regret','regular','reject','relax','release','relief','rely','remain','remember','remind','remove','render','renew','rent','repair','repeat','replace','report','require','rescue','resemble','resist','resource','response','result','retire','retreat','return','reunion','reveal','review','reward','rhythm','rib','ribbon','rice','rich','ride','ridge','rifle','right','rigid','ring','riot','ripple','risk','ritual','rival','river','road','roast','robot','robust','rocket','romance','roof','rookie','room','rose','rotate','rough','round','route','royal','rubber','rude','rug','rule','run','rural','rush','sad','saddle','sadness','safe','sail','salad','salmon','salon','salt','salute','same','sample','sand','satisfy','satoshi','sauce','sausage','save','say','scale','scan','scare','scatter','scene','scheme','school','science','scissors','scorpion','scout','scrap','screen','script','scrub','sea','search','season','seat','second','secret','section','security','seed','seek','segment','select','sell','seminar','senior','sense','sentence','series','service','session','settle','setup','seven','shadow','shaft','shallow','share','shed','shell','sheriff','shield','shift','shine','ship','shiver','shock','shoe','shoot','shop','short','shoulder','shove','shrimp','shrug','shuffle','shy','sibling','sick','side','siege','sight','sign','silent','silk','silly','silver','similar','simple','since','sing','siren','sister','situate','six','size','skate','sketch','ski','skill','skin','skirt','skull','slab','slam','sleep','slender','slice','slide','slight','slim','slogan','slot','slow','slush','small','smart','smile','smoke','smooth','snack','snake','snap','sniff','snow','soap','soccer','social','sock','soda','soft','solar','soldier','solid','solution','solve','someone','song','soon','sorry','sort','soul','sound','soup','source','south','space','spare','spatial','spawn','speak','special','speed','spell','spend','sphere','spice','spider','spike','spin','spirit','split','spoil','sponsor','spoon','sport','spot','spray','spread','spring','spy','square','squeeze','squirrel','stable','stadium','staff','stage','stairs','stamp','stand','start','state','stay','steak','steel','stem','step','stereo','stick','still','sting','stock','stomach','stone','stool','story','stove','strategy','street','strike','strong','struggle','student','stuff','stumble','style','subject','submit','subway','success','such','sudden','suffer','sugar','suggest','suit','summer','sun','sunny','sunset','super','supply','supreme','sure','surface','surge','surprise','surround','survey','suspect','sustain','swallow','swamp','swap','swarm','swear','sweet','swift','swim','swing','switch','sword','symbol','symptom','syrup','system',
  'table','tackle','tag','tail','talent','talk','tank','tape','target','task','taste','tattoo','taxi','teach','team','tell','ten','tenant','tennis','tent','term','test','text','thank','that','theme','then','theory','there','they','thing','this','thought','three','thrive','throw','thumb','thunder','ticket','tide','tiger','tilt','timber','time','tiny','tip','tired','tissue','title','toast','tobacco','today','toddler','toe','together','toilet','token','tomato','tomorrow','tone','tongue','tonight','tool','tooth','top','topic','topple','torch','tornado','tortoise','toss','total','tourist','toward','tower','town','toy','track','trade','traffic','tragic','train','transfer','trap','trash','travel','tray','treat','tree','trend','trial','tribe','trick','trigger','trim','trip','trophy','trouble','truck','true','truly','trumpet','trust','truth','try','tube','tuition','tumble','tuna','tunnel','turkey','turn','turtle','twelve','twenty','twice','twin','twist','two','type','typical','ugly','umbrella','unable','unaware','uncle','uncover','under','undo','unfair','unfold','unhappy','uniform','unique','unit','universe','unknown','unlock','until','unusual','unveil','update','upgrade','uphold','upon','upper','upset','urban','urge','usage','use','used','useful','useless','usual','utility','vacant','vacuum','vague','valid','valley','valve','van','vanish','vapor','various','vast','vault','vehicle','velvet','vendor','venture','venue','verb','verify','version','very','vessel','veteran','viable','vibrant','vicious','victory','video','view','village','vintage','violin','virtual','virus','visa','visit','visual','vital','vivid','vocal','voice','void','volcano','volume','vote','voyage','wage','wagon','wait','walk','wall','walnut','want','warfare','warm','warrior','wash','wasp','waste','water','wave','way','wealth','weapon','wear','weasel','weather','web','wedding','weekend','weird','welcome','west','wet','whale','what','wheat','wheel','when','where','whip','whisper','wide','width','wife','wild','will','win','window','wine','wing','wink','winner','winter','wire','wisdom','wise','wish','witness','wolf','woman','wonder','wood','wool','word','work','world','worry','worth','wrap','wreck','wrestle','wrist','write','wrong','yard','year','yellow','you','young','youth','zebra','zero','zone','zoo'
];

function generateMnemonicServer() {
  const entropy = crypto.randomBytes(17); // 16 bytes + 1 extra for extra randomness
  const bits = [];
  for (let i = 0; i < 17; i++) for (let j = 7; j >= 0; j--) bits.push((entropy[i] >> j) & 1);
  const words = [];
  for (let i = 0; i < 12; i++) {
    let idx = 0;
    for (let j = 0; j < 11; j++) idx = (idx << 1) | bits[i * 11 + j];
    words.push(BIP39_WORDS_SERVER[idx]);
  }
  return words;
}

function hashPhrase(phrase) {
  return crypto.createHash('sha256').update(phrase).digest('hex');
}

// File-based persistent store (survives server restarts, no Firebase needed)
const RECOVERY_FILE = path.join(__dirname, 'recovery_data.json');
function loadStore() {
  try { if (fs.existsSync(RECOVERY_FILE)) return JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf8')); } catch(e) {}
  return { lookup: {}, users: {} };
}
function saveStore(data) {
  try { fs.writeFileSync(RECOVERY_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch(e) { console.error('recovery save error:', e); }
}
const fileStore = loadStore();

// 生成助记词（首次备份时调用）
app.post('/api/recovery/generate', async (req, res) => {
  try {
    const { userid, userId } = req.body;
    const uid = userid || userId;
    if (!uid) return res.status(400).json({ ok: false, message: 'no userId' });

    const phrase = generateMnemonicServer();
    const phraseStr = phrase.join(' ');
    const hash = hashPhrase(phraseStr);

    // Store hash in Firebase if available
    if (db) {
      await db.ref(`recovery_phrases/${uid}`).set({
        hash,
        backedAt: Date.now(),
        restoredAt: null
      });
      await db.ref(`users/${uid}/recoveryBacked`).set(true);
    } else {
      fileStore.lookup[hash] = uid;
      fileStore.users[uid] = fileStore.users[uid] || {};
      saveStore(fileStore);
    }

    res.json({ ok: true, phrase: phrase, hash });
  } catch (e) {
    console.error('recovery generate error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 验证助记词
app.post('/api/recovery/verify', async (req, res) => {
  try {
    const { userid, userId, phrase } = req.body;
    const uid = userid || userId;
    if (!uid) return res.status(400).json({ ok: false, message: 'no userId' });
    if (!phrase || !Array.isArray(phrase) || phrase.length !== 12) {
      return res.status(400).json({ ok: false, message: 'phrase must be 12 words array' });
    }

    const phraseStr = phrase.join(' ');
    const inputHash = hashPhrase(phraseStr);

    let storedHash = null;
    if (db) {
      const snap = await db.ref(`recovery_phrases/${uid}/hash`).once('value');
      storedHash = snap.val();
    }

    if (!storedHash) {
      return res.status(404).json({ ok: false, message: 'No recovery phrase found for this account' });
    }

    if (inputHash !== storedHash) {
      return res.status(400).json({ ok: false, message: 'Recovery phrase does not match' });
    }

    res.json({ ok: true, message: 'Recovery phrase verified successfully' });
  } catch (e) {
    console.error('recovery verify error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 通过助记词恢复账号
app.post('/api/recovery/restore', async (req, res) => {
  try {
    const { userid, userId, phrase } = req.body;
    const uid = userid || userId;
    if (!uid) return res.status(400).json({ ok: false, message: 'no userId' });
    if (!phrase || !Array.isArray(phrase) || phrase.length !== 12) {
      return res.status(400).json({ ok: false, message: 'phrase must be 12 words array' });
    }

    const phraseStr = phrase.join(' ');
    const inputHash = hashPhrase(phraseStr);

    let storedHash = null;
    if (db) {
      const snap = await db.ref(`recovery_phrases/${uid}/hash`).once('value');
      storedHash = snap.val();
    }

    if (!storedHash) {
      return res.status(404).json({ ok: false, message: 'No recovery phrase set up for this account' });
    }

    if (inputHash !== storedHash) {
      return res.status(400).json({ ok: false, message: 'Invalid recovery phrase' });
    }

    // Restore account - update restore timestamp
    if (db) {
      await db.ref(`recovery_phrases/${uid}/restoredAt`).set(Date.now());
    }

    // Fetch user data to return
    let userData = {};
    if (db) {
      const userSnap = await db.ref(`users/${uid}`).once('value');
      userData = userSnap.val() || {};
    }

    res.json({
      ok: true,
      message: 'Account restored successfully',
      userData
    });
  } catch (e) {
    console.error('recovery restore error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 查询助记词备份状态
app.get('/api/recovery/status/:uid', async (req, res) => {
  try {
    const uid = req.params.uid;
    if (!uid) return res.status(400).json({ ok: false, message: 'no userId' });

    let backed = false;
    let hashExists = false;
    let data = {};

    if (db) {
      const snap = await db.ref(`recovery_phrases/${uid}`).once('value');
      data = snap.val() || {};
      hashExists = !!data.hash;
      backed = !!data.hash;
    }

    res.json({
      ok: true,
      backed,
      hasRecoveryPhrase: hashExists,
      backedAt: data.backedAt || null,
      restoredAt: data.restoredAt || null
    });
  } catch (e) {
    console.error('recovery status error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 客户端备份哈希（词即账号：哈希直接作为数据键）
app.post('/api/recovery/backup', async (req, res) => {
  try {
    const { userid, userId, hash } = req.body;
    const uid = userid || userId;
    if (!uid) return res.status(400).json({ ok: false, message: 'no userId' });
    if (!hash) return res.status(400).json({ ok: false, message: 'no hash provided' });

    // Fetch user data to snapshot under recovery key
    let userSnapshot = {};
    if (db) {
      const snap = await db.ref(`users/${uid}`).once('value');
      userSnapshot = snap.val() || {};
    } else {
      userSnapshot = fileStore.users[uid] || {};
    }

    const recoveryPayload = {
      uid,
      backedAt: Date.now(),
      restoredAt: null,
      userData: userSnapshot
    };

    if (db) {
      // Direct key: hash → account data (deterministic, no lookup table needed)
      await db.ref(`recovery_accounts/${hash}`).set(recoveryPayload);
      // Also copy user data under hash key so hash-derived wallet_uid works
      await db.ref(`users/${hash}`).set(userSnapshot);
      // Legacy lookup for backward compat
      await db.ref(`recovery_lookup/${hash}`).set(uid);
      await db.ref(`recovery_phrases/${uid}`).set({ hash, backedAt: Date.now(), restoredAt: null });
      await db.ref(`users/${uid}/recoveryBacked`).set(true);
    } else {
      fileStore.lookup[hash] = uid;
      fileStore.accounts = fileStore.accounts || {};
      fileStore.accounts[hash] = recoveryPayload;
      fileStore.users[uid] = fileStore.users[uid] || {};
      fileStore.users[hash] = userSnapshot;
      saveStore(fileStore);
    }

    res.json({ ok: true, message: 'Recovery phrase backed up successfully' });
  } catch (e) {
    console.error('recovery backup error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// 通过助记词反查用户（换设备恢复用，直接键查找）
app.post('/api/recovery/lookup', async (req, res) => {
  try {
    const { phrase } = req.body;
    if (!phrase || !Array.isArray(phrase) || phrase.length !== 12) {
      return res.status(400).json({ ok: false, message: 'phrase must be 12 words array' });
    }

    const phraseStr = phrase.join(' ');
    const inputHash = hashPhrase(phraseStr);

    let uid = null;
    let userData = {};

    // Priority 1: Direct account key (deterministic, always works)
    if (db) {
      const accountSnap = await db.ref(`recovery_accounts/${inputHash}`).once('value');
      const accountData = accountSnap.val();
      if (accountData && accountData.uid) {
        uid = accountData.uid;
        userData = accountData.userData || {};
      }
    } else if (fileStore.accounts && fileStore.accounts[inputHash]) {
      const accountData = fileStore.accounts[inputHash];
      uid = accountData.uid;
      userData = accountData.userData || {};
    }

    // Priority 2: Legacy lookup table
    if (!uid && db) {
      const uidSnap = await db.ref(`recovery_lookup/${inputHash}`).once('value');
      uid = uidSnap.val();
      if (uid) {
        const userSnap = await db.ref(`users/${uid}`).once('value');
        userData = userSnap.val() || {};
      }
    }
    if (!uid && !db && fileStore.lookup[inputHash]) {
      uid = fileStore.lookup[inputHash];
      userData = fileStore.users[uid] || {};
    }

    if (!uid) {
      return res.status(404).json({ ok: false, message: 'No account found for this recovery phrase' });
    }

    // Mark restored
    if (db) {
      await db.ref(`recovery_phrases/${uid}/restoredAt`).set(Date.now());
    }

    res.json({ ok: true, uid, userData });
  } catch (e) {
    console.error('recovery lookup error:', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Simple ping for connectivity check
app.get('/api/ping', (req, res) => { res.json({ ok: true }); });

/* ---------------------------------------------------------
   Middleware
--------------------------------------------------------- */
app.use(cors({
  origin: '*',
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','x-user-id','x-userid','Authorization','X-User-Id']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname,'public')));

/* ---------------------------------------------------------
   Firebase RTDB init (optional)
--------------------------------------------------------- */
let db = null;
try {
  const admin = require('firebase-admin');
  if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_DATABASE_URL) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
    console.log('✅ Firebase RTDB connected');
  } else {
    console.warn('⚠️ Firebase ENV missing');
  }
} catch (e) {
  console.warn('❌ Firebase init failed:', e.message);
}

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */
function now(){ return Date.now(); }
function usTime(ts){ return new Date(ts).toLocaleString('en-US',{ timeZone:'America/New_York' }); }
function genOrderId(prefix){ return `${prefix || 'ORD'}-${now()}-${Math.floor(1000+Math.random()*9000)}`; }
function safeNumber(v, fallback=0){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function isSafeUid(uid){
  if(!uid || typeof uid !== 'string') return false;
  if(/[.#$\[\]]/.test(uid)) return false;
  if(uid.indexOf('{{') !== -1 || uid.indexOf('}}') !== -1) return false;
  if(uid.length < 2 || uid.length > 512) return false;
  return true;
}
async function ensureUserExists(uid){
  if(!db) return;
  if(!isSafeUid(uid)) return;

  const ref = db.ref(`users/${uid}`);
  const snap = await ref.once('value');

  if(snap.exists()) return;

  const ts = now();
  await ref.set({
  userid: uid,
  wallet: "",
  balance: 0,

  created: ts,        // 注册时间
  loginTime: ts,      // 上线时间
  lastOnline: ts,     // 最后在线

  updated: ts
 });
}

// ================================
// USDT 价格缓存（CoinGecko）
// ================================
const PRICE_CACHE = {
  USDT: 1
};

// CoinGecko 币种映射（常用 + 可无限扩展）
const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  LINK: 'chainlink',
  ATOM: 'cosmos',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  ICP: 'internet-computer',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  NEAR: 'near',
  EOS: 'eos',
  XTZ: 'tezos',
  XLM: 'stellar',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  APE: 'apecoin',
  AXS: 'axie-infinity',
  GALA: 'gala',
  FTM: 'fantom',
  RUNE: 'thorchain',
  KAVA: 'kava',
  CRV: 'curve-dao-token',
  UNI: 'uniswap',
  AAVE: 'aave',
  CAKE: 'pancakeswap-token',
  DYDX: 'dydx',
  INJ: 'injective-protocol',
  SUI: 'sui'
};

// 拉取 CoinGecko 行情（稳定，不封云）
async function fetchCoinGeckoPrices(){
  try{
    const ids = Object.values(COINGECKO_IDS).join(',');
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids,
          vs_currencies: 'usd'
        },
        timeout: 10000
      }
    );

    for(const [symbol, id] of Object.entries(COINGECKO_IDS)){
      const price = res.data[id]?.usd;
      if(price && price > 0){
        PRICE_CACHE[symbol] = price;
      }
    }

    PRICE_CACHE.USDT = 1;
    console.log('[PRICE] CoinGecko updated:', Object.keys(PRICE_CACHE).length);

  }catch(e){
    console.log('[PRICE] CoinGecko error:', e.message);
  }
}

// 启动 & 定时刷新（10 秒一次，后台足够）
fetchCoinGeckoPrices();
setInterval(fetchCoinGeckoPrices, 10000);

// ================================
// USDT 估算工具（统一）
// ================================
function getUSDTPrice(coin){
  if(!coin) return null;
  return PRICE_CACHE[String(coin).toUpperCase()] || null;
}

function calcEstimateUSDT(amount, coin){
  const p = getUSDTPrice(coin);
  if(!p) return null;
  return Number((safeNumber(amount, 0) * p).toFixed(4));
}
/* ---------------------------------------------------------
   SSE utilities
--------------------------------------------------------- */
global.__sseClients = global.__sseClients || [];

function sendSSE(res, payloadStr, eventName){
  try {
    if (res.finished || (res.connection && res.connection.destroyed)) return false;
    if (eventName) res.write(`event: ${eventName}\n`);
    res.write(`data: ${payloadStr}\n\n`);
    return true;
  } catch(e){
    return false;
  }
}

function broadcastSSE(payloadObj){
  const payload = JSON.stringify(payloadObj);
  const toKeep = [];
  global.__sseClients.forEach(client => {
    try {
      const { res, uid } = client;
      if (!res || (res.finished || (res.connection && res.connection.destroyed))) {
        return;
      }
      const eventName = payloadObj && payloadObj.type ? String(payloadObj.type) : null;

      if (payloadObj && payloadObj.order && payloadObj.order.userId) {
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.order.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          toKeep.push(client);
        }
      } else if (payloadObj && payloadObj.userId) {
        if (uid === null || uid === undefined || String(uid) === String(payloadObj.userId)) {
          const ok = sendSSE(res, payload, eventName);
          if (ok) toKeep.push(client);
        } else {
          toKeep.push(client);
        }
      } else {
        const ok = sendSSE(res, payload, eventName);
        if (ok) toKeep.push(client);
      }
    } catch(e){}
  });
  global.__sseClients = toKeep;
}

function objToSortedArray(objOrNull){
  if(!objOrNull) return [];
  try {
    const arr = Object.values(objOrNull);
    return arr.sort((a,b)=> (b.timestamp||b.time||0) - (a.timestamp||a.time||0));
  } catch(e){
    return [];
  }
}

/* ---------------------------------------------------------
   Root
--------------------------------------------------------- */
app.get('/', (_,res)=> res.send('✅ NEXBIT Backend (RTDB) Running'));

/* ---------------------------------------------------------
   Basic user sync
--------------------------------------------------------- */
app.post('/api/users/sync', async (req, res) => {
  try {
    const { userid, userId, invitedBy } = req.body;
    const uid = userid || userId;
    if(!uid) return res.json({ ok:false, message:'no uid' });
    if(!db) return res.json({ ok:true, message:'no-db' });

    const userRef = db.ref('users/' + uid);
    const createdSnap = await userRef.child('created').once('value');
    const createdVal = createdSnap.exists() ? createdSnap.val() : null;
    const created = (createdVal !== null && createdVal !== undefined) ? createdVal : now();
    const balanceSnap = await userRef.child('balance').once('value');

    const balance = safeNumber(balanceSnap.exists() ? balanceSnap.val() : 0, 0);

const userSnap = await userRef.once('value');
const oldData = userSnap.val() || {};

// ===================================
// ✅ 防止覆盖上级关系
// ===================================

const updateData = {

  userid: uid,

  created,
  updated: now(),
  balance,

  loginTime: now(),
  lastOnline: now()

};

// 只有第一次才允许绑定上级
if (
    invitedBy &&
    !oldData.invitedBy &&
    invitedBy !== uid
) {

    updateData.invitedBy = invitedBy;

    console.log(
      '推荐关系绑定成功:',
      uid,
      '->',
      invitedBy
    );
}

await userRef.update(updateData);
    // =====================================
// ✅ 自动创建下级列表
// =====================================
if (
    invitedBy &&
    !oldData.invitedBy &&
    invitedBy !== uid
) {

    await db.ref(`referrals/${invitedBy}/${uid}`).set({

        uid,
        createdAt: Date.now()

    });

    console.log(
        '下级列表创建成功:',
        invitedBy,
        '->',
        uid
    );
}

    return res.json({ ok:true });
  } catch(e){
    console.error('users sync error', e);
    return res.json({ ok:false });
  }
});
app.post('/api/users/online', async (req,res)=>{
  try{

    const { userid, userId } = req.body;
    const uid = userid || userId;

    if(!uid){
      return res.json({ok:false,message:'no uid'});
    }

    if(!db){
      return res.json({ok:true,message:'no-db'});
    }

    const ref = db.ref('users/' + uid);

    await ref.update({
      lastOnline: now()
    });

    res.json({ok:true});

  }catch(e){
    console.error('online error',e);
    res.json({ok:false});
  }
});
// 同步订单记录接口
app.post('/api/orders/sync', async (req, res) => {
  try {

    const { userid, userId } = req.body;
    const uid = userid || userId;

    if (!uid)
      return res.status(400).json({ ok: false, message: 'no userId' });

    if (!db)
      return res.status(500).json({ ok: false, message: 'Database not connected' });

    await ensureUserExists(uid);

    const ordersRef = db.ref(`user_orders/${uid}`);
    const ordersSnap = await ordersRef.once('value');
    const orders = ordersSnap.exists() ? ordersSnap.val() : [];

    res.json({ ok: true, orders });

  } catch (e) {
    console.error('Orders sync error:', e);
    res.status(500).json({ ok: false, message: 'Failed to sync orders' });
  }
});
// 同步币种持有接口
app.post('/api/currency/sync', async (req, res) => {
  try {

    const { userid, userId } = req.body;
    const uid = userid || userId;

    if (!uid)
      return res.status(400).json({ ok: false, message: 'no userId' });

    if (!db)
      return res.status(500).json({ ok: false, message: 'Database not connected' });

    await ensureUserExists(uid);

    // 先读已存储的 portfolio
    const portfolioRef = db.ref(`users/${uid}/portfolio`);
    const portfolioSnap = await portfolioRef.once('value');
    let portfolio = portfolioSnap.exists() ? portfolioSnap.val() : {};

    // 如果 portfolio 为空，从历史 buysell buy 订单中聚合计算持仓并回写
    if (!portfolio || Object.keys(portfolio).length === 0) {
      const buysellSnap = await db.ref('orders/buysell').once('value');
      if (buysellSnap.exists()) {
        const orders = buysellSnap.val();
        const aggregated = {};
        for (const orderId in orders) {
          const order = orders[orderId];
          if (order.userId === uid && String(order.side || '').toLowerCase() === 'buy' && order.coin && order.coinQty) {
            const coin = String(order.coin).toUpperCase();
            const qty = Number(order.coinQty);
            if (qty > 0) {
              aggregated[coin] = Number(((aggregated[coin] || 0) + qty).toFixed(8));
            }
          }
        }
        if (Object.keys(aggregated).length > 0) {
          await portfolioRef.set(aggregated);
          portfolio = aggregated;
        }
      }
    }

    res.json({ ok: true, portfolio });

  } catch (e) {
    console.error('Currency sync error:', e);
    res.status(500).json({ ok: false, message: 'Failed to sync currency' });
  }
});

/* ---------------------------------------------------------
   Balance endpoints
--------------------------------------------------------- */
app.get('/api/balance/:uid', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if (!db) return res.json({ ok:true, balance: 0 });
    await ensureUserExists(uid);
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    return res.json({ ok:true, balance: Number(snap.val() || 0) });
  } catch (e){
    console.error('balance api error', e);
    return res.json({ ok:false, balance: 0 });
  }
});

app.get('/wallet/:uid/balance', async (req, res) => {
  try {
    const uid = String(req.params.uid || '').trim();
    if(!isSafeUid(uid)) return res.status(400).json({ ok:false, error:'invalid uid' });
    if (!db) return res.json({ ok:true, uid, balance: 0 });
    const snap = await db.ref(`users/${uid}/balance`).once('value');
    const balance = safeNumber(snap.exists() ? snap.val() : 0, 0);
    return res.json({ ok:true, uid, balance });
  } catch (e) {
    console.error('/wallet/:uid/balance error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
// === 最终修正版：后台点击确认 -> 存入Firebase -> 前端实时跳动 ===
app.post('/admin/confirm-deposit', async (req, res) => {
  try {
    const { uid, amount } = req.body;
    const numAmount = Number(amount);

    // 1. 检查数据库 (必须使用你代码里的 db 变量)
    if (!db) return res.status(500).json({ ok: false, error: 'Database not connected' });
    if (!uid || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid UID or Amount' });
    }

    // 2. 从 Firebase 获取当前余额并累加
    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    
    // 如果用户不存在，默认余额为 0
    const currentBal = snap.exists() ? Number(snap.val().balance || 0) : 0;
    const newBal = Number((currentBal + numAmount).toFixed(4));

    // 3. 写入数据库 (这才是永久增加金额)
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    console.log(`[后台充值] 成功! UID: ${uid}, 增加了: ${numAmount}, 当前新余额: ${newBal}`);

    // 4. 【核心关键】调用你代码里原有的 broadcastSSE 函数，前端才会自动跳数字
    try {
      broadcastSSE({
        type: 'balance',
        userId: uid,
        balance: newBal,
        source: 'admin_deposit'
      });
    } catch (sseErr) {
      console.error('SSE Broadcast failed:', sseErr);
    }

    return res.json({ ok: true, balance: newBal, msg: "Deposit confirmed and synced" });

  } catch (e) {
    console.error('Admin deposit sync error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
/* ---------------------------------------------------------
   Wallet credit (Convert → USDT 即时到账)
--------------------------------------------------------- */
app.post('/wallet/:uid/credit', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const uid = String(req.params.uid || '').trim();
    const amount = Number(req.body.amount || 0);
    const reason = String(req.body.reason || 'convert');

    if (!isSafeUid(uid))
      return res.status(400).json({ ok:false, error:'invalid uid' });

    if (amount <= 0)
      return res.status(400).json({ ok:false, error:'invalid amount' });

    await ensureUserExists(uid);

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    const curBal = snap.exists()
      ? safeNumber(snap.val().balance, 0)
      : 0;

    const newBal = curBal + amount;

    await userRef.update({
      balance: newBal,
      lastUpdate: now(),
      boost_last: now()
    });

    // 🔔 关键：推送 SSE，前端钱包立即同步
    try {
      broadcastSSE({
        type: 'balance',
        userId: uid,
        balance: newBal,
        source: reason
      });
    } catch(e){}

    return res.json({ ok:true, balance: newBal });

  } catch (e) {
    console.error('/wallet/:uid/credit error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});

/* ---------------------------------------------------------
   Wallet internal deduct (PLAN / TRADE 用)
--------------------------------------------------------- */
app.post('/wallet/:uid/deduct', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const uid = String(req.params.uid || '').trim();
    const amount = Number(req.body.amount || 0);

    if (!isSafeUid(uid))
      return res.status(400).json({ ok:false, error:'invalid uid' });

    if (amount <= 0)
      return res.status(400).json({ ok:false, error:'invalid amount' });

    await ensureUserExists(uid);

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists()
      ? safeNumber(snap.val().balance, 0)
      : 0;

    if (curBal < amount) {
      return res.status(400).json({ ok:false, error:'Insufficient balance' });
    }

    const newBal = curBal - amount;

    await userRef.update({
      balance: newBal,
      lastUpdate: now()
    });

    // 🔔 推送钱包余额（前端 SSE 立刻生效）
    try {
      broadcastSSE({
        type: 'balance',
        userId: uid,
        balance: newBal,
        source: 'plan_deduct'
      });
    } catch(e){}
    // ✅ 保存 PLAN 订单
const planOrder = {
  userId: uid,
  orderId: genOrderId('PLAN'),
  amount: Number(amount),
  currency: req.body.currency || 'USDT',

  // ✅ 必须补齐
  plan: req.body.plan,
  rateMin: Number(req.body.rateMin),
  rateMax: Number(req.body.rateMax),
  days: Number(req.body.days),

  timestamp: now()
};

// 写入数据库（可选但推荐）
if (db) {
  await db.ref(`orders/plan/${planOrder.orderId}`).set(planOrder);
}

// 🔔 发送 Telegram 通知
try {
  await sendPlanOrderToTelegram(planOrder);
} catch (e) {
  console.error('PLAN Telegram notify failed:', e.message);
}

// ==============================
// PLAN购买成功后触发返佣
// ==============================

try {

  await axios.post(

    `${req.protocol}://${req.get('host')}/api/referral/commission`,

    {
      uid,
      amount: Number(amount)
    }

  );

} catch(e){

  console.error(
    'PLAN commission failed:',
    e.message
  );

}

return res.json({ ok:true, balance: newBal });

  } catch (e) {
    console.error('/wallet/:uid/deduct error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
app.post('/api/referral/commission', async (req,res)=>{

  try{

    const {
      uid,
      amount
    } = req.body;

    if(!uid || !amount){
      return res.json({ok:false});
    }

    // =========================
    // 查购买人
    // =========================

    const buyerRef =
      db.ref(`users/${uid}`);

    const buyerSnap =
      await buyerRef.once('value');

    if(!buyerSnap.exists()){
      return res.json({ok:false});
    }

    const buyer =
      buyerSnap.val() || {};

    // =========================
    // 找邀请人
    // =========================

    const inviterId =
     buyer.invitedBy ||   // ✅ 你真正绑定的字段
      buyer.inviter ||
      buyer.invite_ref ||
      buyer.referrer ||
      '';

    if(!inviterId){

      return res.json({
        ok:true,
        noCommission:true
      });

    }

    // =========================
    // 给邀请人加佣金
    // =========================

    const inviterRef =
      db.ref(`users/${inviterId}`);

    const inviterSnap =
      await inviterRef.once('value');

    const oldBal =
      Number(inviterSnap.val()?.balance || 0);

    // 返佣比例
    const commission =
      Number(amount) * 0.10;

    const newBal =
      oldBal + commission;

    await inviterRef.update({

      balance:newBal

    });

    // =========================
    // 保存返佣日志
    // =========================

    const logId =
      Date.now().toString();

    await db.ref(
      `commission_logs/${inviterId}/${logId}`
    ).set({

      buyer:uid,
      amount:Number(amount),
      commission,
      createdAt:Date.now()

    });

    // =========================
    // SSE刷新
    // =========================

    broadcastSSE({

      type:'balance',
      userId:inviterId,
      balance:newBal

    });

    res.json({
      ok:true
    });

  }catch(e){

    console.log(e);

    res.json({
      ok:false
    });

  }

});
/* ---------------------------------------------------------
   Investment Plan Settlement (项目到期自动结算)
   逻辑：由前端触发，后端校验订单唯一性并增加余额
--------------------------------------------------------- */
app.post('/api/plan/settle', async (req, res) => {
  try {
    if (!db) return res.json({ ok: false, error: '数据库未连接' });

    const { uid, orderId, amount, profit } = req.body;

    // 1. 参数基础校验
    if (!uid || !orderId || amount === undefined || profit === undefined) {
      return res.status(400).json({ ok: false, error: '缺少结算必要参数' });
    }

    if (!isSafeUid(uid)) {
      return res.status(400).json({ ok: false, error: '无效的用户ID' });
    }

    // 2. 防止重复结算：检查该订单是否已处理
    const settleCheckRef = db.ref(`settled_plans/${orderId}`);
    const settleSnap = await settleCheckRef.once('value');
    
    if (settleSnap.exists()) {
      return res.status(400).json({ ok: false, error: '该订单已结算，请勿重复提交' });
    }

    // 3. 获取用户信息
    const userRef = db.ref(`users/${uid}`);
    const userSnap = await userRef.once('value');
    if (!userSnap.exists()) {
      return res.status(404).json({ ok: false, error: '找不到该用户' });
    }

    // 4. 计算新余额 (本金 + 利润)
    const currentBalance = safeNumber(userSnap.val().balance, 0);
    const totalReturn = Number(amount) + Number(profit); 
    const newBalance = Number((currentBalance + totalReturn).toFixed(4));

    // 5. 执行更新：增加余额
    await userRef.update({
      balance: newBalance,
      lastUpdate: now()
    });

    // 6. 记录结算状态（防止二次领取）
    await settleCheckRef.set({
      uid,
      refOrderId: orderId,
      amount: Number(amount),
      profit: Number(profit),
      totalReturn,
      settleTime: now(),
      time_us: usTime(now()),
      status: 'completed'
    });

    // 7. 🔔 发送 SSE 广播，使前端余额即时刷新
    try {
      broadcastSSE({
        type: 'balance',
        userId: uid,
        balance: newBalance,
        source: 'plan_settled'
      });
    } catch(e){}

    console.log(`[SETTLE] 成功: 订单 ${orderId} 为用户 ${uid} 增加余额 ${totalReturn}`);
    return res.json({ ok: true, balance: newBalance });

  } catch (e) {
    console.error('Settlement Route Error:', e);
    return res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
});
/* ---------------------------------------------------------
   Admin utility endpoints (set/deduct/boost)
--------------------------------------------------------- */
app.post('/api/admin/balance', async (req, res) => {
  try {

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false });

    const token = auth.slice(7);
    if (!await isValidAdminToken(token))
      return res.status(403).json({ ok:false });

    // 👇 下面才是 balance 逻辑

    // ===============================
    // ✅ 后面只写业务逻辑（不要再验 token）
    // ===============================

    const { user, amount } = req.body;
    if (user === undefined || amount === undefined)
      return res.status(400).json({ ok:false, error:'missing user/amount' });

    if (!db) return res.json({ ok:false, message:'no-db' });
    if (!isSafeUid(user))
      return res.status(400).json({ ok:false, error:'invalid user id' });

    const ref = db.ref(`users/${user}`);
    await ref.update({
      balance: Number(amount),
      lastUpdate: now(),
      boost_last: now()
    });

    // 记录 admin action
    const actId = genOrderId('ADMIN_ACT');
    await db.ref(`admin_actions/${actId}`).set({
      id: actId,
      type: 'set_balance',
      user,
      amount: Number(amount),
      by: 'admin',
      time: now()
    });

    // 记录订单
    const ordId = genOrderId('ORD');
    await db.ref(`orders/recharge/${ordId}`).set({
      orderId: ordId,
      userId: user,
      amount: Number(amount),
      timestamp: now(),
      time_us: usTime(now()),
      type: 'admin_set_balance',
      status: 'completed'
    });

    try {
      broadcastSSE({ type:'balance', userId:user, balance:Number(amount) });
    } catch(e){}

    return res.json({ ok:true, balance:Number(amount) });

  } catch (e) {
    console.error('[admin/balance]', e);
    return res.json({ ok:false });
  }
});


/* ---------------------------------------------------------
   Save Order (centralized)
   - ensures coin is preserved, writes user_orders
   - includes 'processed' flag to prevent double-processing by admin
   - broadcasts both 'new' and buysell events so admin UI and wallet UI both receive
--------------------------------------------------------- */
async function saveOrder(type, data) {

  if (!db) return null;

  const ts = now();

  const allowed = [
    'userId',
    'user',
    'amount',
    'estimate',
    'coin',
    'side',
    'converted',
    'coinQty',
    'tp',
    'sl',
    'note',
    'meta',
    'orderId',
    'status',
    'deducted',
    'wallet',
    'ip',
    'currency'
  ];

  const clean = {};

  Object.keys(data || {}).forEach(k => {
    if (allowed.includes(k)) clean[k] = data[k];
  });

  if (!clean.userId && clean.user) {
    clean.userId = clean.user;
  }

  const id = clean.orderId || genOrderId(type.toUpperCase());

  const payload = {
    ...clean,

    orderId: id,
    timestamp: ts,
    time_us: usTime(ts),

    status: clean.status || 'processing',

    type,
    processed: false,

    coin: clean.coin || null,

    // 保存钱包地址
    wallet: clean.wallet || null,

    // ✅ estimate 修复
    estimate:
      clean.estimate != null
        ? Number(clean.estimate)
        : (
            type === 'buysell'
              ? Number(clean.amount)
              : calcEstimateUSDT(clean.amount, clean.coin)
          ),
  };

  // 保存订单
  await db.ref(`orders/${type}/${id}`).set(payload);

  // user_orders 索引
  if (payload.userId) {

    try {

      await db.ref(`user_orders/${payload.userId}/${id}`).set({
        orderId: id,
        type,
        timestamp: ts
      });

      // 保存钱包地址到用户
      const userRef = db.ref(`users/${payload.userId}`);

      const userSnap = await userRef.once('value');

      const user = userSnap.val() || {};

      const wallets = user.wallets || [];

      if (clean.wallet && !wallets.includes(clean.wallet)) {

        wallets.push(clean.wallet);

        await userRef.update({ wallets });

      }

    } catch(e) {

      console.warn('user_orders write failed:', e.message);

    }
  }

  // 更新 coin 持仓（buysell buy 时累加）
  if (type === 'buysell' && data.side === 'buy' && data.coin && data.coinQty) {
    try {
      const coin = String(data.coin).toUpperCase();
      const portfolioRef = db.ref(`users/${payload.userId}/portfolio/${coin}`);
      const pSnap = await portfolioRef.once('value');
      const existing = pSnap.exists() ? Number(pSnap.val()) : 0;
      await portfolioRef.set(Number((existing + Number(data.coinQty)).toFixed(8)));
    } catch(e) {
      console.warn('portfolio update failed:', e.message);
    }
  }

  // SSE 广播
  try {

    broadcastSSE({
      type: 'new',
      typeName: type,
      userId: payload.userId,
      order: payload
    });

    if (type === 'buysell') {

      broadcastSSE({
        type: 'buysell',
        typeName: type,
        userId: payload.userId,
        order: payload
      });

    }

  } catch(e){}

  return id;
}

/* ---------------------------------------------------------
   BuySell endpoints
   - /proxy/buysell kept for legacy frontends
   - both /proxy/buysell and /api/order/buysell share same logic
   - buy: immediate deduction; sell: create order (admin approval required to credit)
--------------------------------------------------------- */
async function handleBuySellRequest(req, res){
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });

    const {
      userId,
      user,
      side,
      tradeType,   // ✅ 兼容 buysell.html
      coin,
      amount,
      converted,
      tp,
      sl,
      orderId,
      wallet,
      ip
    } = req.body;

    const uid = userId || user;
    await ensureUserExists(uid);
    const realSide = side || tradeType;   // ✅ 关键修复
    const amt = Number(amount || 0);

    if(!uid || !realSide || !coin || amt <= 0){
      return res.status(400).json({ ok:false, error:'missing fields' });
    }
    if(!isSafeUid(uid)){
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const balance = snap.exists() ? safeNumber(snap.val().balance, 0) : 0;

    const sideLower = String(realSide).toLowerCase();

    // ✅ BUY：立即扣钱
    if(sideLower === 'buy'){
      if(balance < amt){
        return res.status(400).json({ ok:false, error:'余额不足' });
      }
      const newBal = balance - amt;
      await userRef.update({ balance: newBal, lastUpdate: now() });
      broadcastSSE({ type:'balance', userId: uid, balance: newBal });
    }

    // ===== 计算币数量（安全版）=====
let coinQty = 0;

// ① 优先用前端传来的币数量
if (converted !== undefined && converted !== null && Number(converted) > 0) {
  coinQty = Number(converted);
}
// ② 否则用 USDT / price 计算
else {
  const price = getUSDTPrice(coin);
  if (price && price > 0) {
    coinQty = Number((amt / price).toFixed(6));
  }
}

// ===== 保存订单 =====
const id = await saveOrder('buysell', {
  userId: uid,
  side: sideLower,
  coin,
  amount: amt,              // USDT（保持不变）
  coinQty,                  // ✅ 新增：币数量
  tp: tp || null,
  sl: sl || null,
  orderId,
  deducted: (sideLower === 'buy'),
  wallet: wallet || null,
  ip: ip || null,
  processed: false
});

    return res.json({ ok:true, orderId: id });
  } catch(e){
    console.error('handleBuySellRequest error', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
}
app.post('/proxy/buysell', handleBuySellRequest);
app.post('/api/order/buysell', handleBuySellRequest);

/* ---------------------------------------------------------
   Recharge endpoint
--------------------------------------------------------- */
app.post('/api/order/recharge', async (req, res) => {
  try {
    if(!db) return res.json({ ok:false, error:'no-db' });
    const payload = req.body || {};
    const userId = payload.userId || payload.user;
    await ensureUserExists(userId);
    if(!userId) return res.status(400).json({ ok:false, error:'missing userId' });
    if(!isSafeUid(userId)) return res.status(400).json({ ok:false, error:'invalid uid' });
    const id = await saveOrder('recharge', payload);
    return res.json({ ok:true, orderId: id });
  } catch(e){ console.error(e); return res.status(500).json({ ok:false, error:e.message }); }
});
/* ---------------------------------------------------------
   Telegram notify (SAFE - backend only)
--------------------------------------------------------- */
app.post('/api/telegram/recharge', upload.single('photo'), async (req, res) => {
  try {
    const token = process.env.RECHARGE_TELEGRAM_BOT_TOKEN;
    const chats = (process.env.RECHARGE_TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);

    if (!token || chats.length === 0) {
      return res.status(500).json({ ok:false, error:'telegram not configured' });
    }

    const text = String(req.body.text || '').slice(0, 4096);

    for (const chatId of chats) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text },
          { timeout: 10000 }
        );
      } catch (err) {
        console.error(`Telegram sendMessage error for chat ${chatId}:`, err.response?.data || err.message);
      }

      if (req.file) {
        try {
          const fd = new FormData();
          fd.append('chat_id', chatId);
          fd.append('photo', req.file.buffer, {
            filename: req.file.originalname || 'proof.jpg'
          });

          await axios.post(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            fd,
            { headers: fd.getHeaders(), timeout: 15000 }
          );
        } catch (err) {
          console.error(`Telegram sendPhoto error for chat ${chatId}:`, err.response?.data || err.message);
        }
      }
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('[telegram notify recharge error]', e.message);
    return res.status(500).json({ ok:false });
  }
});

/* ---------------------------------------------------------
   Withdraw endpoint (deduct immediately)
--------------------------------------------------------- */
app.post('/api/order/withdraw', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

    const payload = req.body || {};
    const userId = payload.userId || payload.user;

    if (!userId) {
      return res.status(400).json({ ok:false, error:'missing userId' });
    }
    if (!isSafeUid(userId)) {
      return res.status(400).json({ ok:false, error:'invalid uid' });
    }

    await ensureUserExists(userId);

    // ===== 关键字段 =====
    const amountCoin = Number(payload.amount || 0);        // 币数量（只记录）
    const estimateUSDT = Number(payload.estimate || 0);    // ✅ USDT（扣款用）

    if (!amountCoin || amountCoin <= 0) {
      return res.status(400).json({ ok:false, error:'invalid amount' });
    }

    if (!estimateUSDT || estimateUSDT <= 0) {
      return res.status(400).json({ ok:false, error:'invalid estimate' });
    }

    const userRef = db.ref(`users/${userId}`);
    const snap = await userRef.once('value');
    const curBal = snap.exists()
      ? safeNumber(snap.val().balance, 0)
      : 0;

    // ✅ 用 USDT 校验余额
    if (curBal < estimateUSDT) {
      return res.status(400).json({ ok:false, error:'余额不足' });
    }

    // ✅ 用 USDT 扣款
    const newBal = curBal - estimateUSDT;

    await userRef.update({
      balance: newBal,
      lastUpdate: now(),
      boost_last: now()
    });

    // 推送余额更新
    try {
      broadcastSSE({
        type: 'balance',
        userId,
        balance: newBal,
        source: 'withdraw_submit'
      });
    } catch(e){}

    // 保存提款订单（币数量 + USDT 都保留）
    const orderId = await saveOrder('withdraw', {
      ...payload,
      userId,
      amount: amountCoin,          // 币数量
      estimate: estimateUSDT,       // USDT
      status: 'pending',
      deducted: true,
      processed: false
    });

    return res.json({ ok:true, orderId });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error: e.message });
  }
});
// ===== 工具函数：按时间倒序 =====
function sortByTimeDesc(arr) {
  return (arr || []).sort(
    (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
  );
}
app.post('/api/telegram/withdraw', upload.single('photo'), async (req, res) => {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chats = (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);

    if (!token || chats.length === 0) {
      return res.status(500).json({ ok:false, error:'telegram not configured' });
    }

    const text = String(req.body.text || '').slice(0, 4096);

    for (const chatId of chats) {
      try {
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text },
          { timeout: 10000 }
        );
      } catch (err) {
        console.error(`Telegram sendMessage error for chat ${chatId}:`, err.response?.data || err.message);
      }

      if (req.file) {
        try {
          const fd = new FormData();
          fd.append('chat_id', chatId);
          fd.append('photo', req.file.buffer, {
            filename: req.file.originalname || 'proof.jpg'
          });

          await axios.post(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            fd,
            { headers: fd.getHeaders(), timeout: 15000 }
          );
        } catch (err) {
          console.error(`Telegram sendPhoto error for chat ${chatId}:`, err.response?.data || err.message);
        }
      }
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('[telegram notify withdraw error]', e.message);
    return res.status(500).json({ ok:false });
  }
});
// Trade Telegram 通知
app.post('/api/telegram/trade', upload.single('photo'), async (req, res) => {
  try {
    const token = process.env.TRADE_BOT_TOKEN;
    const chats = (process.env.TRADE_CHAT_IDS || '').split(',').filter(Boolean);

    if (!token || chats.length === 0) {
      return res.status(500).json({ ok:false, error:'telegram not configured' });
    }

    const text = String(req.body.text || '').slice(0, 4096);

    for (const chatId of chats) {
      try {
        // 发送文字消息
        await axios.post(
          `https://api.telegram.org/bot${token}/sendMessage`,
          { chat_id: chatId, text },
          { timeout: 10000 }
        );
      } catch (err) {
        console.error(`Telegram sendMessage error for chat ${chatId}:`, err.response?.data || err.message);
      }

      // 如果有图片，发送图片
      if (req.file) {
        try {
          const fd = new FormData();
          fd.append('chat_id', chatId);
          fd.append('photo', req.file.buffer, {
            filename: req.file.originalname || 'proof.jpg'
          });

          await axios.post(
            `https://api.telegram.org/bot${token}/sendPhoto`,
            fd,
            { headers: fd.getHeaders(), timeout: 15000 }
          );
        } catch (err) {
          console.error(`Telegram sendPhoto error for chat ${chatId}:`, err.response?.data || err.message);
        }
      }
    }

    return res.json({ ok:true });
  } catch (e) {
    console.error('[telegram notify trade error]', e.message);
    return res.status(500).json({ ok:false });
  }
});
/* ---------------------------------------------------------
   Loan order endpoint (ONLY notify Telegram)
--------------------------------------------------------- */
app.post('/api/order/loan', upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'hand', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      userId,
      amount,
      period
    } = req.body;

    if (!userId || !amount || !period) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

   const front = req.files?.front?.[0];
const back  = req.files?.back?.[0];
const hand  = req.files?.hand?.[0];

// 构造 Telegram 文本（你想要的格式）
const text = `🔥 <b>New Loan Application</b> 🔥

💰 Amount: <b>${amount} USDT</b>
📅 Date: ${new Date().toLocaleString()}
⏳ Period: <b>${period} Days</b>

📷 <b>Photos:</b>
1️⃣ ID Card Front
2️⃣ ID Card Back
3️⃣ Hand-held ID

⚠️ <b>Please save a screenshot of this notification!</b>`;

// 发送到 Telegram 群
await sendLoanToTelegram(text, [front, back, hand]);

return res.json({ success: true, orderId: 'loan_' + Date.now() });


  } catch (e) {
    console.error('[loan order error]', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});
async function sendPlanOrderToTelegram(order) {
  const token = process.env.PLAN_TELEGRAM_BOT_TOKEN;
  const chats = (process.env.PLAN_TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean);
  if (!token || chats.length === 0) return;

  // ✅ 兜底
  const amount   = Number(order.amount) || 0;
  const rateMin  = Number(order.rateMin) || 0;
  const rateMax  = Number(order.rateMax) || 0;
  const days     = Number(order.days) || 1;
  const currency = order.currency || 'USDT';
  const planName = order.plan || 'Unknown Plan';

  const todayEarnings = amount * (rateMin / 100);
  const accumulatedIncome = amount + todayEarnings * days;

  const text = `
📥 New PLAN Order Created📥

📌 Order ID: ${order.orderId}
💵 Amount: ${amount.toFixed(2)} ${currency}
📦 Plan: ${planName}

📊 Today's earnings: ${todayEarnings.toFixed(4)} ${currency}
⚖️ Accumulated income: ${accumulatedIncome.toFixed(4)} ${currency}

📈 Daily Revenue: ${rateMin}% - ${rateMax}%

📆 ${new Date().toLocaleString()}
`.trim();

  for (const chatId of chats) {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text },
      { timeout: 10000 }
    );
  }
}

/* ---------------------------------------------------------
   Get transactions for admin UI
--------------------------------------------------------- */
app.get('/api/transactions', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer '))
      return res.status(403).json({ ok:false });

    const token = auth.slice(7);
    if (!await isValidAdminToken(token))
      return res.status(403).json({ ok:false });

    if (!db) {
      return res.json({
        ok:true,
        recharge: [],
        withdraw: [],
        buysell: [],
        users: {},
        stats: {}
      });
    }

    const [rechargeSnap, withdrawSnap, buysellSnap, usersSnap] =
      await Promise.all([
        db.ref('orders/recharge').once('value'),
        db.ref('orders/withdraw').once('value'),
        db.ref('orders/buysell').once('value'),
        db.ref('users').once('value')
      ]);

    return res.json({
      ok: true,
      recharge: sortByTimeDesc(Object.values(rechargeSnap.val() || {})),
      withdraw: sortByTimeDesc(Object.values(withdrawSnap.val() || {})),
      buysell:  sortByTimeDesc(Object.values(buysellSnap.val() || {})),
      users: usersSnap.val() || {}
    });

  } catch (e) {
    console.error('transactions error', e);
    return res.status(500).json({ ok:false });
  }
});
/* ---------------------------------------------------------
   Admin token helpers
--------------------------------------------------------- */
async function isValidAdminToken(token){
  if (!db || !token) return false;
  try {
    const snap = await db.ref(`admins_by_token/${token}`).once('value');
    if (!snap.exists()) return false;
    const rec = snap.val();
    const ttlDays = safeNumber(process.env.ADMIN_TOKEN_TTL_DAYS, 30); // 30天有效期
    const ageMs = now() - (rec.created || 0);
    if (ageMs > ttlDays * 24 * 60 * 60 * 1000) { 
      try { 
        await db.ref(`admins_by_token/${token}`).remove(); 
      } catch (e) {} 
      return false; 
    }
    return true;
  } catch(e) { return false; }
}



/* ---------------------------------------------------------
   Admin create/login (kept)
--------------------------------------------------------- */
app.post('/api/admin/create', async (req, res) => {
  try {
    const { id, password, createToken } = req.body;
    if (!id || !password) {
      return res.status(400).json({ ok: false, error: 'missing id/password' });
    }

    // 验证创建 Token 是否正确
    if (process.env.ADMIN_BOOTSTRAP_TOKEN && createToken === process.env.ADMIN_BOOTSTRAP_TOKEN) {
      // 如果是引导令牌，允许创建
    } else {
      const auth = req.headers.authorization || '';
      if (!auth.startsWith('Bearer '))
        return res.status(403).json({ ok: false, error: 'forbidden' });

      const adminToken = auth.slice(7);
      if (!await isValidAdminToken(adminToken)) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }
    }

    // 哈希化密码
    const hashed = await bcrypt.hash(password, 10);
    const token = uuidv4();  // 生成管理员 token
    const created = now();   // 获取当前时间戳

    // 保存管理员信息到 Firebase 数据库
    await db.ref(`admins/${id}`).set({
      id,
      hashed,
      created,
      isSuper: false   // 设置为普通管理员，修改为 true 则为超级管理员
    });

    // 生成管理员 token
    await db.ref(`admins_by_token/${token}`).set({
      id,
      created
    });

    return res.json({ ok: true, id, token });  // 返回管理员信息和 token

  } catch (e) {
    console.error('admin create error', e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});

/* --------------------------------------------------
   Utils
-------------------------------------------------- */
app.post('/api/admin/login', async (req, res) => {
  try {
    const { id, password } = req.body;
    if (!id || !password)
      return res.status(400).json({ ok: false, error: 'missing id/password' });

    const snap = await db.ref(`admins/${id}`).once('value');
    if (!snap.exists())
      return res.status(404).json({ ok: false, error: 'admin not found' });

    const admin = snap.val();
    const passOk = await bcrypt.compare(password, admin.hashed);  // 比较密码
    if (!passOk)
      return res.status(401).json({ ok: false, error: 'incorrect password' });

    const token = uuidv4();  // 生成新 token
    await db.ref(`admins_by_token/${token}`).set({
      id,
      created: now()  // 保存 token 和创建时间
    });

    return res.json({ ok: true, token });  // 返回登录成功的 token

  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});
/* ---------------------------------------------------------
   Admin: approve/decline transactions (idempotent)
   - prevents double-processing by checking 'processed' flag
--------------------------------------------------------- */
app.post('/api/transaction/update', async (req, res) => {
  try {
    if (!db) return res.json({ ok:false, error:'no-db' });

const auth = req.headers.authorization || '';
if (!auth.startsWith('Bearer '))
  return res.status(403).json({ ok:false });

const token = auth.slice(7);
if (!await isValidAdminToken(token))
  return res.status(403).json({ ok:false });


    const adminRec = await db.ref(`admins_by_token/${token}`).once('value');
    const adminId = adminRec.exists() ? adminRec.val().id : 'admin';

    const { type, orderId, status, note } = req.body;
    if (!type || !orderId) return res.status(400).json({ ok:false, error:'missing type/orderId' });

    const ref = db.ref(`orders/${type}/${orderId}`);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ ok:false, error:'order not found' });

    const order = snap.val();

    // prevent double-processing
    if (order.processed === true) {
      // still record admin action but don't apply balance changes again
      const actIdSkip = uuidv4();
      await db.ref(`admin_actions/${actIdSkip}`).set({ id: actIdSkip, admin: adminId, type, orderId, status, note, time: now(), skipped:true });
      return res.json({ ok:true, message:'already processed' });
    }

    // update order status and mark processed after applying business logic
    const actId = uuidv4();
    await db.ref(`admin_actions/${actId}`).set({ id: actId, admin: adminId, type, orderId, status, note, time: now() });

    // handle balance effects
    const userId = order && order.userId ? order.userId : null;
    if (userId) {
      const userRef = db.ref(`users/${userId}`);
      const uSnap = await userRef.once('value');
      let curBal = uSnap.exists() ? safeNumber(uSnap.val().balance, 0) : 0;
      const amt = Number(order.estimate || 0);
// 1️⃣ 先更新状态（不 processed）
await ref.update({
  status,
  note: note || null,
  updated: now()
});

// 2️⃣ 统一计算状态
const statusNorm = String(status || '').toLowerCase();

// ✅ 统一批准
const isApproved = (
  statusNorm === 'success' ||
  statusNorm === 'approved' ||
  statusNorm === 'pass' ||
  statusNorm === '通过'
);

// ✅ 统一拒绝 / 取消（补全中文 & 常见值）
const isRejected = (
  statusNorm === 'failed' ||
  statusNorm === 'reject' ||
  statusNorm === 'rejected' ||
  statusNorm === 'cancel' ||
  statusNorm === 'canceled' ||
  statusNorm === 'decline' ||
  statusNorm === 'deny' ||
  statusNorm === '拒绝' ||
  statusNorm === '取消'
);

if (isApproved) {
  if (type === 'recharge') {
    curBal += amt;
    await userRef.update({
      balance: curBal,
      lastUpdate: now(),
      boost_last: now()
    });

    broadcastSSE({
      type: 'balance',
      userId,
      balance: curBal,
      source: 'recharge_approved'
    });
  }
 }

// ===== 所有余额业务逻辑 =====
// ===== withdraw 拒绝 → 退回 USDT（estimate）=====
if (
  type === 'withdraw' &&
  isRejected &&
  order.deducted === true &&
  order.refunded !== true
) {
  const refundUSDT = Number(order.estimate || 0); // ✅ USDT

  if (refundUSDT > 0) {
    curBal += refundUSDT;

    await userRef.update({
      balance: curBal,
      lastUpdate: now(),
      boost_last: now()
    });

    await ref.update({ refunded: true });

    broadcastSSE({
      type: 'balance',
      userId,
      balance: curBal,
      source: 'withdraw_refund'
    });
  }
}

// ===== buysell sell 通过 → 加钱（保持原样）=====
else if (
  type === 'buysell' &&
  isApproved &&
  String(order.side || '').toLowerCase() === 'sell'
) {
  curBal += amt; // amt 在 buysell 里本来就是 USDT
  await userRef.update({
    balance: curBal,
    lastUpdate: now(),
    boost_last: now()
  });

  broadcastSSE({
    type: 'balance',
    userId,
    balance: curBal
  });
}
// ===== ✅【最终正确】统一写回最终状态 + processed =====
let finalStatus = null;

if (isApproved) finalStatus = "approved";
if (isRejected) finalStatus = "rejected";

if (finalStatus) {
  await ref.update({
    status: finalStatus,
    processed: true,
    updated: now()
  });
}

// ===== 再广播订单更新 =====
const newSnap = await ref.once('value');
const latestOrder = { ...newSnap.val(), orderId };

broadcastSSE({
  type: 'update',
  typeName: type,
  userId: latestOrder.userId,
  order: latestOrder,
  action: { admin: adminId, status, note }
});
}
return res.json({ ok: true });

} catch (e) {
  console.error('transaction.update err', e);
  return res.status(500).json({ ok:false, error: e.message });
}
});

/* ---------------------------------------------------------
   SSE endpoints
--------------------------------------------------------- */
app.get('/api/orders/stream', async (req, res) => {
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);
  global.__sseClients.push({ res, uid: null, ka });
  req.on('close', () => { clearInterval(ka); global.__sseClients = global.__sseClients.filter(c => c.res !== res); });
});

app.get('/wallet/:uid/sse', async (req, res) => {
  const uid = String(req.params.uid || '').trim();
  await ensureUserExists(uid);
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'Connection':'keep-alive' });
  res.flushHeaders();
  const ka = setInterval(()=>{ try{ res.write(':\n\n'); } catch(e){} }, 15000);
  global.__sseClients.push({ res, uid, ka });
  try {
    if (!db) sendSSE(res, JSON.stringify({ type:'balance', userId: uid, balance: 0 }), 'balance');
    else {
      const snap = await db.ref(`users/${uid}/balance`).once('value');
      const bal = safeNumber(snap.exists() ? snap.val() : 0, 0);
      sendSSE(res, JSON.stringify({ type:'balance', userId: uid, balance: bal }), 'balance');
    }
  } catch(e){}
  req.on('close', () => { clearInterval(ka); global.__sseClients = global.__sseClients.filter(c => c.res !== res); });
});

/* ---------------------------------------------------------
   Firebase watchers
--------------------------------------------------------- */
try {
  if (db) {
    const ordersRef = db.ref('orders');
    ordersRef.on('child_changed', (snap) => {
      try {
        const kind = snap.key;
        const val = snap.val() || {};
        Object.values(val).forEach(ord => { try { broadcastSSE({ type:'update', typeName: kind, order:ord }); } catch(e){} });
      } catch(e){}
    });
    ordersRef.on('child_added', (snap) => {
      try {
        const kind = snap.key;
        const val = snap.val() || {};
        Object.values(val).forEach(ord => { try { broadcastSSE({ type: (kind === 'buysell' ? 'buysell' : 'new'), typeName: kind, order:ord }); } catch(e){} });
      } catch(e){}
    });

    const usersRef = db.ref('users');
    usersRef.on('child_changed', (snap) => {
      try {
        const uid = snap.key;
        const data = snap.val() || {};
   
      } catch(e){}
    });
  }
} catch(e){ console.warn('SSE firebase watch failed', e.message); }

/* ---------------------------------------------------------
   Ensure default admin (bootstrap)
--------------------------------------------------------- */
async function ensureDefaultAdmin() {
  if (!db) return;

  const snap = await db.ref('admins/admin').once('value');
  if (snap.exists()) return;

  const hashed = await bcrypt.hash('970611', 10);
  const token = uuidv4();
  const created = now();

  await db.ref('admins/admin').set({
    id: 'admin',
    hashed,
    created,
    isSuper: true
  });

  await db.ref(`admins_by_token/${token}`).set({
    id: 'admin',
    created
  });

  console.log('✅ Default admin created');
}
ensureDefaultAdmin();

/* ---------------------------------------------------------
   【新增】自动结算定时任务 (每分钟检查一次)
   作用：即便用户不在线，服务器也会自动检查到期的 PLAN 并打钱
--------------------------------------------------------- */
// ✅ 修改后的代码（直接替换 server.js 最末尾的 setInterval 部分）
setInterval(async () => {
  if (!db) return;
  try {
    const nowTs = Date.now();
    const ordersSnap = await db.ref('orders/plan').once('value');
    if (!ordersSnap.exists()) return;

    const orders = ordersSnap.val();

    for (const orderId in orders) {
      const order = orders[orderId];
      const uid = order.userId || order.uid;
      
      // 1. 状态检查：只处理非 completed 的订单
      if (order.status === 'completed' || order.status === 'settled') continue;

      // 2. 强制转换数字，防止出现 NaN
      const amount = Number(order.amount || 0);
      const rateMin = Number(order.rateMin || 0);
      const days = Number(order.days || 1);
      let startTs = Number(order.timestamp);

      if (isNaN(amount) || amount <= 0) {
        console.warn(`[跳过] 订单 ${orderId} 金额异常`);
        continue;
      }

      // 时间兼容处理
      if (startTs < 10000000000) startTs *= 1000; 
      const endTime = startTs + (days * 86400000);

      // 3. 到期判断
      if (nowTs >= endTime) {
        // 二次防止重复结算
        const settleCheck = await db.ref(`settled_plans/${orderId}`).once('value');
        if (settleCheck.exists()) {
          await db.ref(`orders/plan/${orderId}`).update({ status: 'completed' });
          continue;
        }

        // 计算收益
        const profit = Number((amount * (rateMin / 100)).toFixed(4));
        const totalReturn = Number((amount + profit).toFixed(4));

        const userRef = db.ref(`users/${uid}`);
        const userSnap = await userRef.once('value');
        
        if (userSnap.exists()) {
          const currentBal = Number(userSnap.val().balance || 0);
          // 关键修复：确保加法运算不会产生 NaN
          const newBal = Number((currentBal + totalReturn).toFixed(4));

          if (isNaN(newBal)) {
            console.error(`[致命错误] 结算结果为NaN: User:${uid}, Bal:${currentBal}, Return:${totalReturn}`);
            continue; 
          }

          // 执行更新
          await userRef.update({
            balance: newBal,
            lastUpdate: nowTs
          });

          // 标记已结算
          await db.ref(`settled_plans/${orderId}`).set({
            uid,
            refOrderId: orderId,
            amount,
            profit,
            totalReturn,
            settleTime: nowTs,
            status: 'completed',
            auto: true
          });

          await db.ref(`orders/plan/${orderId}`).update({ status: 'completed' });

          broadcastSSE({
            type: 'balance',
            userId: uid,
            balance: newBal,
            source: 'auto_plan_settle'
          });

          console.log(`✅ [结算成功] 订单:${orderId}, 用户:${uid}, 新余额:${newBal}`);
        }
      }
    }
  } catch (err) {
    console.error('[自动结算任务出错]:', err.message);
  }
}, 60000);
/* =========================================================
   新平台专属：后台管理逻辑 (不影响旧平台)
========================================================= */

// 1. 后台确认充值：金额直接入账并同步
app.post('/admin/confirm-deposit', async (req, res) => {
  try {
    const { uid, amount } = req.body;
    const numAmount = Number(amount);
    if (!db || isNaN(numAmount)) return res.status(400).json({ ok: false });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const newBal = Number(((snap.exists() ? snap.val().balance : 0) + numAmount).toFixed(4));

    await userRef.update({ balance: newBal, lastUpdate: Date.now() });

    // 实时推送
    broadcastSSE({ type: 'balance', userId: uid, balance: newBal, source: 'admin_deposit' });
    return res.json({ ok: true, balance: newBal });
  } catch (e) { return res.status(500).json({ ok: false }); }
});

// 2. 后台拒绝提款：金额原路退回并同步
app.post('/admin/reject-withdraw', async (req, res) => {
  try {
    const { uid, amount, orderId } = req.body;
    const refundAmount = Number(amount);
    if (!db || isNaN(refundAmount)) return res.status(400).json({ ok: false });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');
    const newBal = Number(((snap.exists() ? snap.val().balance : 0) + refundAmount).toFixed(4));

    // 退钱并修改订单状态
    await userRef.update({ balance: newBal });
    await db.ref(`orders/withdraw/${orderId}`).update({ status: 'rejected' });

    // 实时推送
    broadcastSSE({ type: 'balance', userId: uid, balance: newBal, source: 'withdraw_rejected' });
    return res.json({ ok: true, balance: newBal });
  } catch (e) { return res.status(500).json({ ok: false }); }
});
/* =========================================================
   Esport 下注逻辑：检测余额并直接扣除
========================================================= */
app.post('/admin/esport-bet', async (req, res) => {
  try {
    const { uid, amount, gameInfo } = req.body;
    const betAmount = Number(amount);

    if (!db) return res.status(500).json({ ok: false, error: '数据库未连接' });
    if (isNaN(betAmount) || betAmount <= 0) return res.status(400).json({ ok: false, error: '金额无效' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) return res.status(404).json({ ok: false, error: '用户不存在' });

    const currentBal = Number(snap.val().balance || 0);

    // --- 第一步：检测余额是否足够 ---
    if (currentBal < betAmount) {
      return res.status(400).json({ ok: false, error: '余额不足，无法下注' });
    }

    // --- 第二步：直接扣钱 ---
    const newBal = Number((currentBal - betAmount).toFixed(4));
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    // --- 第三步：记录订单 (写入 Firebase) ---
    const betId = 'BET' + Date.now();
    await db.ref(`orders/esport/${betId}`).set({
      uid,
      amount: betAmount,
      gameInfo,
      status: 'pending',
      time: Date.now()
    });

    // --- 第四步：实时同步前端余额 ---
    broadcastSSE({
      type: 'balance',
      userId: uid,
      balance: newBal,
      source: 'esport_bet'
    });

    console.log(`[Esport下注] 用户 ${uid} 下注成功，扣除: ${betAmount}, 剩余: ${newBal}`);
    
    return res.json({ ok: true, balance: newBal, betId });

  } catch (e) {
    console.error('Esport bet error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});
/* ---------------------------------------------------------
   Lucky Bonus Endpoint (新添加)
--------------------------------------------------------- */
app.post('/api/claim-bonus', async (req, res) => {
  try {
    const { uid, bonusAmount } = req.body;
    const amount = parseFloat(bonusAmount);

    // 安全校验：防止非法金额或缺失UID
    if (!uid || isNaN(amount) || amount <= 0 || amount > 100) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const currentBal = Number(snap.val().balance || 0);
    const newBal = Number((currentBal + amount).toFixed(4));

    // 更新 Firebase 中的余额
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    // 记录奖金日志（可选，建议加上以便对账）
    const bonusId = 'BN-' + Date.now();
    await db.ref(`orders/bonus/${bonusId}`).set({
      uid,
      amount: amount,
      type: 'lucky_wheel',
      time: Date.now()
    });

    // 关键：通过 SSE 实时通知前端刷新余额
    broadcastSSE({
      type: 'balance',
      userId: uid,
      balance: newBal,
      source: 'lucky_bonus'
    });

    return res.json({ success: true, balance: newBal });
  } catch (e) {
    console.error('Bonus claim error:', e);
    return res.status(500).json({ success: false });
  }
});
/* =========================================================
   UFC/NBA 下注逻辑：检测余额并扣除 (逻辑同 esport)
========================================================= */
app.post('/api/bet/ufcnba', async (req, res) => {
  try {
    const { uid, amount, projectName, name, result } = req.body;
    const betAmount = Number(amount);

    if (!db) return res.status(500).json({ success: false, message: '数据库连接失败' });
    if (isNaN(betAmount) || betAmount <= 0) return res.status(400).json({ success: false, message: '无效金额' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) return res.status(404).json({ success: false, message: '用户不存在' });

    const currentBal = Number(snap.val().balance || 0);

    // --- 步骤 1：余额检测 ---
    if (currentBal < betAmount) {
      return res.status(400).json({ success: false, message: '余额不足，请先充值' });
    }

    // --- 步骤 2：执行扣款 ---
    const newBal = Number((currentBal - betAmount).toFixed(4));
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    // --- 步骤 3：记录订单 ---
    const orderId = 'UFC-' + Date.now();
    await db.ref(`orders/ufcnba/${orderId}`).set({
      uid,
      projectName,
      teamName: name,
      betResult: result,
      amount: betAmount,
      status: 'pending',
      orderTime: Date.now()
    });

    // --- 步骤 4：实时推送 ---
    broadcastSSE({
      type: 'balance',
      userId: uid,
      balance: newBal,
      source: 'ufcnba_bet'
    });

    return res.json({ success: true, balance: newBal });

  } catch (e) {
    console.error('UFC/NBA bet error:', e);
    return res.status(500).json({ success: false, message: '系统错误' });
  }
});
/* =========================================================
   2-3D 彩票下注逻辑：检测余额并扣除
========================================================= */
app.post('/api/bet/2-3d', async (req, res) => {
  try {
    const { uid, amount, numbers, type, date, time } = req.body;
    const betAmount = Number(amount);

    if (!db) return res.status(500).json({ success: false, message: '数据库连接失败' });
    if (isNaN(betAmount) || betAmount <= 0) return res.status(400).json({ success: false, message: '无效金额' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) return res.status(404).json({ success: false, message: '用户不存在' });

    const currentBal = Number(snap.val().balance || 0);

    // --- 步骤 1：余额检测 ---
    if (currentBal < betAmount) {
      return res.status(400).json({ success: false, message: '余额不足，无法下注' });
    }

    // --- 步骤 2：执行扣款 ---
    const newBal = Number((currentBal - betAmount).toFixed(4));
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    // --- 步骤 3：记录订单 (存入 2-3d 专用路径) ---
    const orderId = 'LOT-' + Date.now();
    await db.ref(`orders/lottery_23d/${orderId}`).set({
      uid,
      betNumbers: numbers,
      betType: type,
      amount: betAmount,
      selectedDate: date,
      selectedTime: time,
      status: 'pending',
      createTime: Date.now()
    });

    // --- 步骤 4：实时推送余额更新 ---
    broadcastSSE({
      type: 'balance',
      userId: uid,
      balance: newBal,
      source: '2-3d_bet'
    });

    console.log(`[2-3D下注] 用户 ${uid} 成功, 扣除: ${betAmount}, 剩余: ${newBal}`);

    return res.json({ success: true, balance: newBal, orderId });

  } catch (e) {
    console.error('2-3D bet error:', e);
    return res.status(500).json({ success: false, message: '系统繁忙' });
  }
});
/* =========================================================
   Sport (体育/足球) 下注逻辑：检测余额并扣除
========================================================= */
app.post('/api/bet/sport', async (req, res) => {
  try {
    const { uid, amount, projectName, name, result, date, time } = req.body;
    const betAmount = Number(amount);

    if (!db) return res.status(500).json({ success: false, message: '数据库连接失败' });
    if (isNaN(betAmount) || betAmount <= 0) return res.status(400).json({ success: false, message: '无效下注金额' });

    const userRef = db.ref(`users/${uid}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) return res.status(404).json({ success: false, message: '用户不存在' });

    const currentBal = Number(snap.val().balance || 0);

    // --- 步骤 1：余额安全检测 ---
    if (currentBal < betAmount) {
      return res.status(400).json({ success: false, message: '余额不足，请充值后再下注' });
    }

    // --- 步骤 2：执行扣款 ---
    const newBal = Number((currentBal - betAmount).toFixed(4));
    await userRef.update({
      balance: newBal,
      lastUpdate: Date.now()
    });

    // --- 步骤 3：记录体育订单 ---
    const orderId = 'SP-' + Date.now();
    await db.ref(`orders/sport/${orderId}`).set({
      uid,
      projectName, // 比赛名称/联赛
      teamName: name, // 下注的对象
      betSide: result, // 下注的方向 (如：主胜/客胜/大球)
      amount: betAmount,
      matchDate: date,
      matchTime: time,
      status: 'pending',
      createTime: Date.now()
    });

    // --- 步骤 4：实时同步前端余额 ---
    broadcastSSE({
      type: 'balance',
      userId: uid,
      balance: newBal,
      source: 'sport_bet'
    });

    console.log(`[Sport下注] 用户 ${uid} 成功, 扣除: ${betAmount}, 剩余: ${newBal}`);

    return res.json({ success: true, balance: newBal, orderId });

  } catch (e) {
    console.error('Sport bet error:', e);
    return res.status(500).json({ success: false, message: '服务器异常' });
  }
});
    /* =========================================================
   获取佣金信息
========================================================= */
app.post('/api/commission/info', async (req,res)=>{

    try{

        const { uid } = req.body;

        if(!uid){

            return res.json({
                ok:false,
                message:'missing uid'
            });

        }

        const userRef =
            db.ref(`users/${uid}`);

        const snap =
            await userRef.once('value');

        if(!snap.exists()){

            return res.json({
                ok:false,
                message:'user not found'
            });

        }

        const userData =
            snap.val() || {};

        res.json({

            ok:true,

            claimableCommission:
                Number(userData.claimableCommission || 0),

            claimedCommission:
                Number(userData.claimedCommission || 0)

        });

    }catch(e){

        console.log(e);

        res.json({
            ok:false,
            message:e.message
        });

    }

});
    /* =========================================================
   领取佣金
========================================================= */
app.post('/api/commission/claim', async (req,res)=>{

    try{

        const { uid } = req.body;

        if(!uid){

            return res.json({
                ok:false,
                message:'missing uid'
            });

        }

        const userRef =
            db.ref(`users/${uid}`);

        const snap =
            await userRef.once('value');

        if(!snap.exists()){

            return res.json({
                ok:false,
                message:'user not found'
            });

        }

        const userData =
            snap.val() || {};

        // 当前可领取佣金
        const claimable =
            Number(userData.claimableCommission || 0);

        if(claimable <= 0){

            return res.json({
                ok:false,
                message:'no commission'
            });

        }

        // 当前余额
        const oldBalance =
            Number(userData.balance || 0);

        // 已领取佣金
        const oldClaimed =
            Number(userData.claimedCommission || 0);

        // 更新数据
       await userRef.update({

    balance:
        oldBalance + claimable,

    claimedCommission:
        oldClaimed + claimable,

    claimableCommission: 0

});

// 实时刷新余额
broadcastSSE({

    type:'balance',

    userId: uid,

    balance:
        oldBalance + claimable

});

// 实时刷新佣金
broadcastSSE({

    type:'commission',

    userId: uid,

    claimableCommission: 0,

    claimedCommission:
        oldClaimed + claimable

});

res.json({

    ok:true,

    amount: claimable,

    balance:
        oldBalance + claimable

});

    }catch(e){

        console.log(e);

        res.json({
            ok:false,
            message:e.message
        });

    }

});

/* =========================================================
   PLAN 投资返佣
========================================================= */
app.post('/api/plan/commission', async (req,res)=>{

    try{

        const {
            uid,
            userid,
            userId,
            amount
        } = req.body;

        // ======================================
        // ✅ 自动兼容 uid / userid / userId
        // ======================================
        const realUid =
            uid || userid || userId;

        if(!realUid || !amount){

            return res.json({
                ok:false,
                message:'missing params'
            });

        }

        // ======================================
        // 当前用户
        // ======================================
        const userRef =
            db.ref(`users/${realUid}`);

        const snap =
            await userRef.once('value');

        if(!snap.exists()){

            return res.json({
                ok:false,
                message:'user not found'
            });

        }

        const userData = snap.val() || {};

        // ======================================
        // 没有上级
        // ======================================
        if(!userData.invitedBy){

            return res.json({
                ok:true,
                message:'no inviter'
            });

        }

        const inviterUid =
            userData.invitedBy;

        // ======================================
        // 🌟 返佣规则
        // 投资 >=1000 USDT
        // 上级获得 50 USDT
        // ======================================
        let commission = 0;

        if(Number(amount) >= 1000){

            commission = 50;

        }

        if(commission <= 0){

            return res.json({
                ok:true,
                message:'no commission'
            });

        }

        // ======================================
        // 上级数据
        // ======================================
        const inviterRef =
            db.ref(`users/${inviterUid}`);

        const inviterSnap =
            await inviterRef.once('value');

        const inviterData =
            inviterSnap.val() || {};

        // 当前待领取佣金
        const oldCommission =
            Number(
                inviterData.claimableCommission || 0
            );

        // ======================================
        // ✅ 更新佣金
        // ======================================
        await inviterRef.update({

            claimableCommission:
                oldCommission + commission

        });

        // ======================================
        // ✅ SSE 实时刷新
        // ======================================
        broadcastSSE({

            type:'commission',

            userId: inviterUid,

            claimableCommission:
                oldCommission + commission,

            claimedCommission:
                Number(
                    inviterData.claimedCommission || 0
                )

        });

        // ======================================
        // ✅ 保存返佣记录
        // ======================================
        const logId =
            Date.now().toString();

        await db.ref(
            `commissionLogs/${logId}`
        ).set({

            fromUid: realUid,

            inviterUid,

            amount: Number(amount),

            commission,

            createdAt: Date.now()

        });

        console.log(

            `返佣成功 ${realUid} -> ${inviterUid} +${commission}`

        );

        res.json({
            ok:true
        });

    }catch(e){

        console.log(e);

        res.json({

            ok:false,

            message:e.message

        });

    }

});
    /* =========================================================
   绑定邀请人
========================================================= */
app.post('/api/bind-inviter', async (req,res)=>{

    try{

        const { uid, inviterId } = req.body;

        if(!uid || !inviterId){

            return res.json({
                ok:false,
                message:'missing params'
            });

        }

        // 自己不能邀请自己
        if(uid === inviterId){

            return res.json({
                ok:false,
                message:'cannot invite self'
            });

        }

        const userRef =
            db.ref(`users/${uid}`);

        const snap =
            await userRef.once('value');

        // 用户不存在
        if(!snap.exists()){

            return res.json({
                ok:false,
                message:'user not found'
            });

        }

        const userData =
            snap.val() || {};

        // 已绑定过上级
        if(userData.invitedBy){

            return res.json({
                ok:true,
                message:'already binded'
            });

        }

        // 写入邀请关系
        await userRef.update({

            invitedBy: inviterId

        });
    
    // =====================================
// 🌟 新增：记录下级列表
// =====================================
await db.ref(`referrals/${inviterId}/${uid}`).set({

    uid,
    createdAt: Date.now()

});

        console.log(
            `绑定邀请成功 ${uid} -> ${inviterId}`
        );

        return res.json({
            ok:true
        });

    }catch(e){

        console.log(e);

        return res.json({
            ok:false,
            message:e.message
        });

    }

});
 // ======================================
// 获取下级列表
// ======================================

app.get('/api/referrals/:uid', async (req,res)=>{

    try{

        const uid =
            req.params.uid;

        if(!uid){

            return res.json({
                ok:false,
                list:[]
            });

        }

        const snap =
            await db.ref(
                `referrals/${uid}`
            ).once('value');

        const val =
            snap.val() || {};

        const list =
            Object.values(val);

        return res.json({

            ok:true,
            list

        });

    }catch(e){

        console.log(e);

        return res.json({

            ok:false,
            list:[]

        });

    }

});
/* ---------------------------------------------------------
   Start server
--------------------------------------------------------- */

app.listen(PORT, () => { console.log('🚀 Server running on', PORT); });
