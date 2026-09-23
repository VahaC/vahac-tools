// UTM Campaign URL Builder — script.js
// Prefix: ucb-
//
// Dependencies: qrcode-generator v2.0.4 (MIT, Kazuhiko Arase) — loaded on demand by ensureQrLib()
// CDN: https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js
// Same library and version as the vCard and Wi-Fi QR generators, so the browser cache is shared.
//
// GA4 channel check: "Channels for manual traffic" in Google Analytics Help,
// [GA4] Default channel group — https://support.google.com/analytics/answer/9756891
// Source lists: Google's "GA4 default-channel-group sources and categories" spreadsheet linked
// from that article, retrieved 2026-09-23 (129 search, 592 social, 46 video, 52 shopping sources).
// Google describes the social list as a regex list; this tool matches its entries exactly.

(function () {
  'use strict';

  var QR_LIB_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.min.js';
  var STORE_DRAFT = 'ucb-draft';
  var STORE_PREFS = 'ucb-prefs';
  var STORE_PRESETS = 'ucb-presets';
  var STORE_LINKS = 'ucb-links';
  var MAX_LINKS = 500;
  var MAX_PRESETS = 50;
  var QUIET = 4;

  var $ = function (id) { return document.getElementById(id); };

  // ── Parameters ──────────────────────────────────────────

  // Appended to the URL in this order
  var PARAMS = [
    { key: 'utm_source', field: 'source', label: 'Source' },
    { key: 'utm_medium', field: 'medium', label: 'Medium' },
    { key: 'utm_campaign', field: 'campaign', label: 'Campaign' },
    { key: 'utm_id', field: 'id', label: 'Campaign ID' },
    { key: 'utm_term', field: 'term', label: 'Term' },
    { key: 'utm_content', field: 'content', label: 'Content' },
    { key: 'utm_source_platform', field: 'platform', label: 'Source platform' },
    { key: 'utm_creative_format', field: 'format', label: 'Creative format' },
    { key: 'utm_marketing_tactic', field: 'tactic', label: 'Marketing tactic' }
  ];

  var FIELDS = PARAMS.map(function (p) { return p.field; });

  var UTM_KEYS = Object.create(null);
  PARAMS.forEach(function (p) { UTM_KEYS[p.key] = p; });

  // Click and tracking IDs that belong to one earlier visit. Reused in a new link they
  // credit every new visitor to that old click, so they are dropped from pasted URLs.
  var CLICK_IDS = ['gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid', 'srsltid', 'fbclid', 'msclkid', 'ttclid',
    'twclid', 'li_fat_id', 'igshid', 'igsh', 'yclid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', '_ga', '_gl'];

  // Ad-platform placeholders filled in at click time: {{campaign.name}} (Meta),
  // {campaignid} (Google Ads, Microsoft Ads), __CAMPAIGN_NAME__ (TikTok)
  var MACRO_RE = /\{\{[A-Za-z0-9_.:-]+\}\}|\{[A-Za-z0-9_.:-]+\}|__[A-Z][A-Z0-9_]*__/g;

  // ── GA4 default channel group (manual traffic) ──────────

  var PAID_RE = /^(.*cp.*|ppc|retargeting|paid.*)$/;
  var SHOP_CAMPAIGN_RE = /^(.*(([^a-df-z]|^)shop|shopping).*)$/;
  var VIDEO_MEDIUM_RE = /^(.*video.*)$/;
  var DISPLAY_MEDIUMS = ['display', 'banner', 'expandable', 'interstitial', 'cpm'];
  var SOCIAL_MEDIUMS = ['social', 'social-network', 'social-media', 'sm', 'social network', 'social media'];
  var REFERRAL_MEDIUMS = ['referral', 'app', 'link'];
  var EMAIL_VALUES = ['email', 'e-mail', 'e_mail', 'e mail'];

  // Google's source list, lower-cased and space-separated. "Google Shopping" is added below.
  var GA4_SOURCES = {
    search:
      '360.cn alice aol ar.search.yahoo.com ask at.search.yahoo.com au.search.yahoo.com auone avg ' +
      'babylon baidu biglobe biglobe.co.jp biglobe.ne.jp bing br.search.yahoo.com ca.search.yahoo.com ' +
      'centrum.cz ch.search.yahoo.com cl.search.yahoo.com cn.bing.com cnn co.search.yahoo.com comcast ' +
      'conduit daum daum.net de.search.yahoo.com dk.search.yahoo.com dogpile dogpile.com duckduckgo ' +
      'ecosia.org email.seznam.cz eniro es.search.yahoo.com espanol.search.yahoo.com exalead.com ' +
      'excite.com fi.search.yahoo.com firmy.cz fr.search.yahoo.com globo go.mail.ru google google-play ' +
      'hk.search.yahoo.com id.search.yahoo.com in.search.yahoo.com incredimail it.search.yahoo.com ' +
      'kvasir lens.google.com lite.qwant.com lycos m.baidu.com m.naver.com m.search.naver.com ' +
      'm.sogou.com mail.rambler.ru mail.yandex.ru malaysia.search.yahoo.com msn msn.com ' +
      'mx.search.yahoo.com najdi naver naver.com news.google.com nl.search.yahoo.com ' +
      'no.search.yahoo.com ntp.msn.com nz.search.yahoo.com onet onet.pl pe.search.yahoo.com ' +
      'ph.search.yahoo.com pl.search.yahoo.com play.google.com qwant qwant.com rakuten rakuten.co.jp ' +
      'rambler rambler.ru se.search.yahoo.com search-results search.aol.co.uk search.aol.com ' +
      'search.google.com search.smt.docomo.ne.jp search.ukr.net secureurl.ukr.net seznam seznam.cz ' +
      'sg.search.yahoo.com so.com sogou sogou.com sp-web.search.auone.jp startsiden startsiden.no ' +
      'suche.aol.de terra th.search.yahoo.com tr.search.yahoo.com tut.by tw.search.yahoo.com ' +
      'uk.search.yahoo.com ukr us.search.yahoo.com virgilio vn.search.yahoo.com wap.sogou.com ' +
      'webmaster.yandex.ru websearch.rakuten.co.jp yahoo yahoo.co.jp yahoo.com yandex yandex.by ' +
      'yandex.com yandex.com.tr yandex.fr yandex.kz yandex.ru yandex.ua yandex.uz zen.yandex.ru',
    social:
      '43things 43things.com 51.com 5ch.net hatena imageshack academia.edu activerain activerain.com ' +
      'activeworlds activeworlds.com addthis addthis.com airg.ca allnurses.com allrecipes.com ' +
      'alumniclass alumniclass.com ameba.jp ameblo.jp americantowns americantowns.com amp.reddit.com ' +
      'ancestry.com anobii anobii.com answerbag answerbag.com answers.yahoo.com aolanswers ' +
      'aolanswers.com apps.facebook.com ar.pinterest.com artstation.com askubuntu askubuntu.com ' +
      'asmallworld.com athlinks athlinks.com away.vk.com awe.sm b.hatena.ne.jp baby-gaga baby-gaga.com ' +
      'babyblog.ru badoo badoo.com bebo bebo.com beforeitsnews beforeitsnews.com bharatstudent ' +
      'bharatstudent.com biip.no biswap.org bit.ly blackcareernetwork.com blackplanet blackplanet.com ' +
      'blip.fm blog.com blog.feedspot.com blog.goo.ne.jp blog.naver.com blog.yahoo.co.jp blogg.no ' +
      'bloggang.com blogger blogger.com blogher blogher.com bloglines bloglines.com blogs.com blogsome ' +
      'blogsome.com blogspot blogspot.com blogster blogster.com blurtit blurtit.com ' +
      'bookmarks.yahoo.co.jp bookmarks.yahoo.com br.pinterest.com brightkite brightkite.com brizzly ' +
      'brizzly.com business.facebook.com buzzfeed buzzfeed.com buzznet buzznet.com cafe.naver.com ' +
      'cafemom cafemom.com camospace camospace.com canalblog.com care.com care2 care2.com ' +
      'caringbridge.org catster catster.com cbnt.io cellufun cellufun.com centerblog.net chat.zalo.me ' +
      'chegg.com chicagonow chicagonow.com chiebukuro.yahoo.co.jp classmates classmates.com classquest ' +
      'classquest.com co.pinterest.com cocolog-nifty cocolog-nifty.com copainsdavant.linternaute.com ' +
      'couchsurfing.org cozycot cozycot.com cross.tv crunchyroll crunchyroll.com cyworld cyworld.com ' +
      'cz.pinterest.com d.hatena.ne.jp dailystrength.org deluxe.com deviantart deviantart.com dianping ' +
      'dianping.com digg digg.com diigo diigo.com discover.hubpages.com disqus disqus.com dogster ' +
      'dogster.com dol2day dol2day.com doostang doostang.com dopplr dopplr.com douban douban.com ' +
      'draft.blogger.com draugiem.lv drugs-forum drugs-forum.com dzone dzone.com edublogs.org elftown ' +
      'elftown.com epicurious.com everforo.com exblog.jp extole extole.com facebook facebook.com ' +
      'faceparty faceparty.com fandom.com fanpop fanpop.com fark fark.com fb fb.me fc2 fc2.com feedspot ' +
      'feministing feministing.com filmaffinity filmaffinity.com flickr flickr.com flipboard ' +
      'flipboard.com folkdirect folkdirect.com foodservice foodservice.com forums.androidcentral.com ' +
      'forums.crackberry.com forums.imore.com forums.nexopia.com forums.webosnation.com ' +
      'forums.wpcentral.com fotki fotki.com fotolog fotolog.com foursquare foursquare.com ' +
      'free.facebook.com friendfeed friendfeed.com fruehstueckstreff.org fubar fubar.com gaiaonline ' +
      'gaiaonline.com gamerdna gamerdna.com gather.com geni.com getpocket.com glassboard glassboard.com ' +
      'glassdoor glassdoor.com godtube godtube.com goldenline.pl goldstar goldstar.com goo.gl gooblog ' +
      'goodreads goodreads.com google+ googlegroups.com googleplus govloop govloop.com gowalla ' +
      'gowalla.com gree.jp groups.google.com gulli.com gutefrage.net habbo habbo.com hi5 hi5.com ' +
      'hootsuite hootsuite.com houzz houzz.com hoverspot hoverspot.com hr.com hu.pinterest.com ' +
      'hubculture hubculture.com hubpages.com hyves.net hyves.nl ibibo ibibo.com id.pinterest.com ' +
      'identi.ca ig imageshack.com imageshack.us imvu imvu.com in.pinterest.com insanejournal ' +
      'insanejournal.com instagram instagram.com instapaper instapaper.com internations.org ' +
      'interpals.net intherooms intherooms.com irc-galleria.net is.gd italki italki.com jammerdirect ' +
      'jammerdirect.com jappy.com jappy.de kaboodle.com kakao kakao.com kakaocorp.com kaneva kaneva.com ' +
      'kin.naver.com l.facebook.com l.instagram.com l.messenger.com last.fm librarything ' +
      'librarything.com lifestream.aol.com line line.me linkedin linkedin.com listal listal.com ' +
      'listography listography.com livedoor.com livedoorblog livejournal livejournal.com ' +
      'lm.facebook.com lnkd.in m.blog.naver.com m.cafe.naver.com m.facebook.com m.kin.naver.com ' +
      'm.vk.com m.yelp.com mbga.jp medium.com meetin.org meetup meetup.com meinvz.net meneame.net ' +
      'menuism.com messages.google.com messages.yahoo.co.jp messenger messenger.com mix.com mixi.jp ' +
      'mobile.facebook.com mocospace mocospace.com mouthshut mouthshut.com movabletype movabletype.com ' +
      'mubi mubi.com my.opera.com myanimelist.net myheritage myheritage.com mylife mylife.com ' +
      'mymodernmet mymodernmet.com myspace myspace.com netvibes netvibes.com news.ycombinator.com ' +
      'newsshowcase nexopia ngopost.org niconico nicovideo.jp nightlifelink nightlifelink.com ning ' +
      'ning.com nl.pinterest.com odnoklassniki.ru odnoklassniki.ua okwave.jp old.reddit.com ' +
      'oneworldgroup.org onstartups onstartups.com opendiary opendiary.com oshiete.goo.ne.jp ' +
      'out.reddit.com over-blog.com overblog.com paper.li partyflock.nl photobucket photobucket.com ' +
      'pinboard pinboard.in pingsta pingsta.com pinterest pinterest.at pinterest.ca pinterest.ch ' +
      'pinterest.cl pinterest.co.kr pinterest.co.uk pinterest.com pinterest.com.au pinterest.com.mx ' +
      'pinterest.de pinterest.es pinterest.fr pinterest.it pinterest.jp pinterest.nz pinterest.ph ' +
      'pinterest.pt pinterest.ru pinterest.se pixiv.net pl.pinterest.com playahead.se plurk plurk.com ' +
      'plus.google.com plus.url.google.com pocket.co posterous posterous.com pro.homeadvisor.com ' +
      'pulse.yahoo.com qapacity qapacity.com quechup quechup.com quora quora.com qzone.qq.com ravelry ' +
      'ravelry.com reddit reddit.com redux redux.com renren renren.com researchgate.net reunion ' +
      'reunion.com reverbnation reverbnation.com rtl.de ryze ryze.com salespider salespider.com ' +
      'scoop.it screenrant screenrant.com scribd scribd.com scvngr scvngr.com secondlife secondlife.com ' +
      'serverfault serverfault.com shareit sharethis sharethis.com shvoong.com sites.google.com skype ' +
      'skyrock skyrock.com slashdot.org slideshare.net smartnews.com snapchat snapchat.com social ' +
      'sociallife.com.br socialvibe socialvibe.com spaces.live.com spoke spoke.com spruz spruz.com ' +
      'ssense.com stackapps stackapps.com stackexchange stackexchange.com stackoverflow ' +
      'stackoverflow.com stardoll.com stickam stickam.com studivz.net suomi24.fi superuser ' +
      'superuser.com sweeva sweeva.com t.co t.me tagged tagged.com taggedmail taggedmail.com talkbiznow ' +
      'talkbiznow.com taringa.net techmeme techmeme.com tencent tencent.com tiktok tiktok.com tinyurl ' +
      'tinyurl.com toolbox toolbox.com touch.facebook.com tr.pinterest.com travellerspoint ' +
      'travellerspoint.com tripadvisor tripadvisor.com trombi trombi.com trustpilot tudou tudou.com ' +
      'tuenti tuenti.com tumblr tumblr.com tweetdeck tweetdeck.com twitter twitter.com twoo.com typepad ' +
      'typepad.com unblog.fr urbanspoon.com ushareit.com ushi.cn vampirefreaks vampirefreaks.com ' +
      'vampirerave vampirerave.com vg.no video.ibm.com vk.com vkontakte.ru wakoopa wakoopa.com wattpad ' +
      'wattpad.com web.facebook.com web.skype.com webshots webshots.com wechat wechat.com weebly ' +
      'weebly.com weibo weibo.com wer-weiss-was.de weread weread.com whatsapp whatsapp.com ' +
      'wiki.answers.com wikihow.com wikitravel.org woot.com wordpress wordpress.com wordpress.org xanga ' +
      'xanga.com xing xing.com yahoo-mbga.jp yammer yammer.com yelp yelp.co.uk yelp.com youroom.in ' +
      'za.pinterest.com zalo zoo.gr zooppa zooppa.com',
    video:
      'blog.twitch.tv crackle crackle.com curiositystream curiositystream.com d.tube dailymotion ' +
      'dailymotion.com dashboard.twitch.tv disneyplus disneyplus.com fast.wistia.net help.hulu.com ' +
      'help.netflix.com hulu hulu.com id.twitch.tv iq.com iqiyi iqiyi.com jobs.netflix.com justin.tv ' +
      'm.twitch.tv m.youtube.com music.youtube.com netflix netflix.com player.twitch.tv ' +
      'player.vimeo.com ted ted.com twitch twitch.tv utreon utreon.com veoh veoh.com ' +
      'viadeo.journaldunet.com vimeo vimeo.com wistia wistia.com youku youku.com youtube youtube.com',
    shopping:
      'igshopping aax-us-east.amazon-adsystem.com aax.amazon-adsystem.com alibaba alibaba.com amazon ' +
      'amazon.co.uk amazon.com apps.shopify.com checkout.shopify.com checkout.stripe.com ' +
      'cr.shopping.naver.com cr2.shopping.naver.com ebay ebay.co.uk ebay.com ebay.com.au ebay.de etsy ' +
      'etsy.com m.alibaba.com m.shopping.naver.com mercadolibre mercadolibre.com mercadolibre.com.ar ' +
      'mercadolibre.com.mx message.alibaba.com msearch.shopping.naver.com nl.shopping.net ' +
      'no.shopping.net offer.alibaba.com one.walmart.com order.shopping.yahoo.co.jp ' +
      'partners.shopify.com s3.amazonaws.com se.shopping.net shop.app shopify shopify.com ' +
      'shopping.naver.com shopping.yahoo.co.jp shopping.yahoo.com shopzilla shopzilla.com ' +
      'simplycodes.com store.shopping.yahoo.co.jp stripe stripe.com uk.shopping.net walmart walmart.com'
  };

  var SOURCE_CATEGORY = Object.create(null);
  Object.keys(GA4_SOURCES).forEach(function (cat) {
    GA4_SOURCES[cat].split(' ').forEach(function (name) {
      if (name) SOURCE_CATEGORY[name] = cat;
    });
  });
  SOURCE_CATEGORY['google shopping'] = 'shopping';

  // ── Advice data ─────────────────────────────────────────

  // Mediums GA4 does not recognise → the closest value it does
  var MEDIUM_FIXES = {
    newsletter: 'email', newsletters: 'email', 'e-newsletter': 'email', enewsletter: 'email',
    mail: 'email', emails: 'email', mailing: 'email', mailchimp: 'email', edm: 'email',
    social_media: 'social', socialmedia: 'social', social_network: 'social', socialnetwork: 'social',
    organic_social: 'social', 'organic-social': 'social', social_post: 'social', 'social-post': 'social',
    post: 'social', posts: 'social',
    text: 'sms', texts: 'sms', text_message: 'sms', 'text-message': 'sms', mms: 'sms',
    podcast: 'audio', podcasts: 'audio',
    partner: 'referral', partners: 'referral', guest_post: 'referral', 'guest-post': 'referral',
    blog: 'referral', backlink: 'referral',
    affiliates: 'affiliate', affiliate_link: 'affiliate', 'affiliate-link': 'affiliate',
    display_ad: 'display', 'display-ad': 'display', banner_ad: 'banner', 'banner-ad': 'banner', banners: 'banner',
    seo: 'organic'
  };

  // Mediums with no default GA4 channel on purpose (offline campaigns)
  var OFFLINE_MEDIUMS = ['print', 'qr', 'qr_code', 'qr-code', 'qrcode', 'offline', 'flyer', 'poster',
    'direct_mail', 'direct-mail', 'tv', 'radio', 'billboard', 'ooh', 'event', 'events', 'packaging', 'business_card'];

  // Words that say "this is an ad" but do not match GA4's paid pattern
  var PAID_HINTS = ['ad', 'ads', 'advert', 'adverts', 'advertising', 'sponsored', 'boost', 'boosted', 'promoted', 'paid'];

  // Typical medium values, used to spot a swapped source and medium
  var MEDIUM_WORDS = ['email', 'e-mail', 'e_mail', 'social', 'paid_social', 'paid-social', 'cpc', 'ppc', 'cpm',
    'display', 'banner', 'affiliate', 'referral', 'organic', 'video', 'audio', 'print', 'push'];

  // Source spellings GA4 does not list → the listed name
  var SOURCE_ALIASES = {
    x: 'twitter', 'x.com': 'twitter', 'www.x.com': 'twitter',
    meta: 'facebook', meta_ads: 'facebook', 'meta-ads': 'facebook', metaads: 'facebook',
    yt: 'youtube'
  };

  // Plain platform names GA4 lists; "facebook_ads" or "www.facebook.com" contain one of them
  var PLATFORM_NAMES = ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'pinterest', 'reddit',
    'youtube', 'snapchat', 'whatsapp', 'google', 'bing', 'yahoo', 'duckduckgo', 'baidu', 'yandex',
    'amazon', 'ebay', 'etsy', 'vimeo', 'twitch', 'quora', 'tumblr'];

  // ── Presets ─────────────────────────────────────────────
  // Every preset uses values GA4 maps to the intended channel (checked in the unit tests).
  // An empty source means "the user names the partner or site".

  var PRESETS = [
    { group: 'Email and messaging', items: [
      { id: 'newsletter', label: 'Email newsletter', source: 'newsletter', medium: 'email' },
      { id: 'email-signature', label: 'Email signature', source: 'email_signature', medium: 'email' },
      { id: 'sms', label: 'SMS / text message', source: 'sms', medium: 'sms' },
      { id: 'whatsapp', label: 'WhatsApp message', source: 'whatsapp', medium: 'social' }
    ] },
    { group: 'Social posts', items: [
      { id: 'facebook', label: 'Facebook post', source: 'facebook', medium: 'social' },
      { id: 'instagram', label: 'Instagram bio or story', source: 'instagram', medium: 'social',
        note: 'Instagram links are clickable in your bio, stories and DMs, not in post captions.' },
      { id: 'linkedin', label: 'LinkedIn post', source: 'linkedin', medium: 'social' },
      { id: 'twitter', label: 'X (Twitter) post', source: 'twitter', medium: 'social',
        note: 'GA4’s source list knows “twitter” and “t.co” but not “x”, so keep “twitter” as the source.' },
      { id: 'tiktok', label: 'TikTok profile or video', source: 'tiktok', medium: 'social' },
      { id: 'pinterest', label: 'Pinterest pin', source: 'pinterest', medium: 'social' },
      { id: 'reddit', label: 'Reddit post', source: 'reddit', medium: 'social' },
      { id: 'youtube', label: 'YouTube video description', source: 'youtube', medium: 'video' }
    ] },
    { group: 'Paid ads', items: [
      { id: 'facebook-ads', label: 'Facebook ads', source: 'facebook', medium: 'paid_social' },
      { id: 'instagram-ads', label: 'Instagram ads', source: 'instagram', medium: 'paid_social' },
      { id: 'linkedin-ads', label: 'LinkedIn ads', source: 'linkedin', medium: 'paid_social' },
      { id: 'tiktok-ads', label: 'TikTok ads', source: 'tiktok', medium: 'paid_social' },
      { id: 'google-ads', label: 'Google Ads (manual tagging)', source: 'google', medium: 'cpc',
        note: 'If Google Ads is linked to GA4 with auto-tagging on, you usually don’t need manual tags for it.' },
      { id: 'microsoft-ads', label: 'Microsoft Advertising (Bing)', source: 'bing', medium: 'cpc' },
      { id: 'display', label: 'Display banner', source: '', medium: 'display',
        note: 'Enter the website or ad network that shows the banner as the source.' }
    ] },
    { group: 'Partners, print and local', items: [
      { id: 'affiliate', label: 'Affiliate link', source: '', medium: 'affiliate',
        note: 'Enter the affiliate’s name as the source.' },
      { id: 'referral', label: 'Partner site or guest post', source: '', medium: 'referral',
        note: 'Enter the website that links to you as the source.' },
      { id: 'podcast', label: 'Podcast or audio ad', source: '', medium: 'audio',
        note: 'Enter the show or audio platform as the source.' },
      { id: 'gbp', label: 'Google Business Profile', source: 'google_business_profile', medium: 'organic',
        note: 'Tags the website link on your Business Profile, so visits from Maps and local search stand apart from plain google / organic.' },
      { id: 'print', label: 'QR code on print (flyer, poster)', source: 'flyer', medium: 'print',
        note: 'Change the source to poster, menu or business_card to match where the code is printed.' }
    ] }
  ];

  var DEFAULT_PRESET_HINT = 'Presets fill in a source and medium that GA4 recognises. Saved presets stay in this browser.';

  // ── Pure helpers (exported for tests) ───────────────────

  function str(v) {
    return v == null ? '' : String(v);
  }

  function lowerTrim(v) {
    return str(v).trim().toLowerCase();
  }

  function inList(list, value) {
    return list.indexOf(value) !== -1;
  }

  function own(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
  }

  function msg(level, text, action) {
    var m = { level: level, text: text };
    if (action) m.action = action;
    return m;
  }

  // Split into code points; a lone surrogate stays a single unit
  function codePoints(s) {
    s = str(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) {
          out.push(s.slice(i, i + 2));
          i++;
          continue;
        }
      }
      out.push(s.charAt(i));
    }
    return out;
  }

  // Replace lone surrogates (encodeURIComponent throws on them) with U+FFFD
  function wellFormed(s) {
    return codePoints(s).map(function (ch) {
      var c = ch.charCodeAt(0);
      return ch.length === 1 && c >= 0xD800 && c <= 0xDFFF ? String.fromCharCode(0xFFFD) : ch;
    }).join('');
  }

  // RFC 3986 component encoding. Also escapes ! ' ( ) * so the link survives Markdown,
  // HTML attributes and chat apps that end a link at a parenthesis or quote.
  function strictEncode(s) {
    return encodeURIComponent(wellFormed(s)).replace(/[!'()*]/g, function (c) {
      return '%' + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }

  function safeDecode(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  var SPACE_MODES = { underscore: '_', hyphen: '-', keep: '' };

  function normalizeOptions(o) {
    o = o || {};
    return {
      lowercase: o.lowercase !== false,
      spaces: own(SPACE_MODES, o.spaces) !== undefined ? o.spaces : 'underscore',
      macros: o.macros !== false
    };
  }

  // Split a value into text and ad-platform placeholder segments
  function segmentValue(value, macros) {
    var s = str(value);
    if (!s) return [];
    if (!macros) return [{ text: s, macro: false }];
    var out = [];
    var re = new RegExp(MACRO_RE.source, 'g');
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ text: s.slice(last, m.index), macro: false });
      out.push({ text: m[0], macro: true });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last), macro: false });
    return out;
  }

  // Tidy one value the way it will be sent: trim, drop a pasted "utm_x=" prefix,
  // lowercase and replace spaces outside placeholders.
  // Returns { value, stripped, macros[] }
  function normalizeValue(raw, options) {
    options = normalizeOptions(options);
    var s = str(raw).replace(/[\r\n\t]+/g, ' ').trim();
    var stripped = '';
    var prefix = /^(utm_[a-z_]+)\s*=\s*/i.exec(s);
    if (prefix) {
      stripped = prefix[1].toLowerCase();
      s = s.slice(prefix[0].length).trim();
    }
    var repl = SPACE_MODES[options.spaces];
    var macros = [];
    var value = segmentValue(s, options.macros).map(function (seg) {
      if (seg.macro) {
        macros.push(seg.text);
        return seg.text;
      }
      var t = seg.text;
      if (options.lowercase) t = t.toLowerCase();
      if (repl) t = t.replace(/\s+/g, repl);
      return t;
    }).join('');
    return { value: value, stripped: stripped, macros: macros };
  }

  // Encoded segments of a normalised value (placeholders stay as they are)
  function encodeSegments(value, macros) {
    return segmentValue(value, macros).map(function (seg) {
      return { text: seg.macro ? seg.text : strictEncode(seg.text), macro: seg.macro };
    });
  }

  function encodeValue(value, macros) {
    return encodeSegments(value, macros).map(function (seg) { return seg.text; }).join('');
  }

  function isHex(ch) {
    return /^[0-9a-fA-F]$/.test(ch || '');
  }

  // Percent-encode what is unsafe to leave raw in a shared link: spaces, control and
  // non-ASCII characters, " < > ` and a % that does not start an escape.
  // Existing %XX escapes and {placeholders} stay as they are.
  function encodeUnsafe(s) {
    var chars = codePoints(wellFormed(s));
    var out = '';
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var c = ch.charCodeAt(0);
      if (ch === '%') {
        out += isHex(chars[i + 1]) && isHex(chars[i + 2]) ? '%' : '%25';
      } else if (ch.length > 1 || c <= 32 || c >= 127 || ch === '"' || ch === '<' || ch === '>' || ch === '`') {
        out += encodeURIComponent(ch);
      } else {
        out += ch;
      }
    }
    return out;
  }

  function shorten(s, max) {
    s = str(s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // ── Landing-page URL ────────────────────────────────────

  // Parse the landing page without re-serialising it: existing parameters are kept
  // byte for byte, UTM tags and click IDs are taken out, the #fragment stays last.
  function parseBaseUrl(raw) {
    var res = {
      ok: false, empty: false, error: '',
      origin: '', path: '', kept: [], fragment: '',
      found: {}, foundCount: 0, removed: [], messages: []
    };
    var note = function (level, text, action) { res.messages.push(msg(level, text, action)); };
    var s = str(raw).replace(/[\r\n\t]/g, '').trim();
    if (!s) {
      res.empty = true;
      return res;
    }

    if (/^\/\//.test(s)) {
      s = 'https:' + s;
    } else {
      var scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
      var hostPort = /^[^\/?#:@]+:\d+([\/?#]|$)/.test(s); // localhost:8080/page, example.com:8080
      if (scheme && !hostPort) {
        if (!/^https?$/i.test(scheme[1])) {
          res.error = 'Only web addresses (http:// or https://) can carry UTM tags, not “' + shorten(scheme[1], 20) + ':” links.';
          return res;
        }
        s = s.replace(/^(https?):\/*/i, function (all, p) { return p.toLowerCase() + '://'; });
      } else {
        s = 'https://' + s;
        note('info', 'Added https:// to the address.');
      }
    }

    var u = null;
    try {
      u = new URL(s);
    } catch (e) {
      u = null;
    }
    var m = /^([a-z]+:)\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#[\s\S]*)?$/i.exec(s);
    if (!u || !u.hostname || !m || !m[2]) {
      res.error = 'This doesn’t look like a complete web address. Check it and try again, e.g. https://example.com/page';
      return res;
    }

    var authority = m[2];
    if (authority.indexOf('@') !== -1) {
      note('warn', 'The address contains a user name or password before “@”. Remove it before you share the link.');
    }
    if (/[^\x21-\x7e]/.test(authority)) {
      authority = u.host;
      note('info', 'The domain was converted to its ASCII form (' + u.hostname + ') so every app and QR scanner can open it.');
    }
    var host = u.hostname;
    if (host.indexOf('.') === -1 && host !== 'localhost' && host.charAt(0) !== '[') {
      note('warn', 'The address “' + shorten(host, 40) + '” has no domain ending such as .com. Check it is complete.');
    }

    var rest = m[3] + (m[4] || '') + (m[5] || '');
    if (/\s/.test(rest)) {
      note('warn', 'The address contains spaces. They were encoded as %20; open the link to check it still reaches the right page.');
    }

    res.origin = m[1].toLowerCase() + '//' + authority;
    res.path = encodeUnsafe(m[3] || '/');

    var query = m[4] ? m[4].slice(1) : '';
    query.split('&').forEach(function (piece) {
      if (!piece) return;
      var eq = piece.indexOf('=');
      var rawKey = eq === -1 ? piece : piece.slice(0, eq);
      var name = safeDecode(rawKey.replace(/\+/g, ' ')).trim();
      if (UTM_KEYS[name]) {
        if (!own(res.found, name) && res.found[name] === undefined) {
          res.found[name] = eq === -1 ? '' : safeDecode(piece.slice(eq + 1).replace(/\+/g, ' '));
          res.foundCount++;
        }
        return;
      }
      if (inList(CLICK_IDS, name.toLowerCase())) {
        if (!inList(res.removed, name)) res.removed.push(name);
        return;
      }
      res.kept.push(encodeUnsafe(piece));
    });
    res.fragment = m[5] ? encodeUnsafe(m[5]) : '';

    if (res.foundCount) {
      var tags = Object.keys(res.found).map(function (k) {
        return k + '=' + shorten(res.found[k], 24);
      });
      note('info', 'This address already has UTM tags (' + tags.join(', ') + '). The fields below replace them.',
        { id: 'import', label: 'Load them into the fields' });
    }
    if (res.removed.length) {
      note('info', 'Removed ' + res.removed.join(', ') + ': click IDs copied from an earlier visit would credit new visitors to that old click.');
    }
    if (/[?=&]/.test(res.fragment)) {
      note('info', 'The part after # stays at the end of the link. UTM tags go before the #, where GA4 reads them.');
    }
    res.ok = true;
    return res;
  }

  // The landing page without UTM tags and click IDs
  function cleanUrl(parsed) {
    if (!parsed || !parsed.ok) return '';
    return parsed.origin + parsed.path + (parsed.kept.length ? '?' + parsed.kept.join('&') : '') + parsed.fragment;
  }

  // ── GA4 channel prediction ──────────────────────────────

  function sourceCategory(source) {
    var key = lowerTrim(source);
    return key && SOURCE_CATEGORY[key] ? SOURCE_CATEGORY[key] : '';
  }

  // GA4 default channel group for manually tagged traffic. Rules are checked top to
  // bottom in the order Google lists them; matching is case-insensitive and a missing
  // value counts as "(not set)". Returns { name, reason, kind: 'ok' | 'unassigned' }.
  function predictChannel(source, medium, campaign) {
    var s = lowerTrim(source) || '(not set)';
    var m = lowerTrim(medium) || '(not set)';
    var c = lowerTrim(campaign) || '(not set)';
    var cat = sourceCategory(s);
    var paid = PAID_RE.test(m);
    var shop = SHOP_CAMPAIGN_RE.test(c);
    var q = function (v) { return '“' + v + '”'; };
    var listed = function (kind) { return q(s) + ' is on Google’s list of ' + kind + ' sites'; };
    var paidText = 'the medium ' + q(m) + ' matches GA4’s paid pattern (cpc, ppc, retargeting, paid…)';
    var shopText = 'the campaign name matches GA4’s shopping pattern (“shop” or “shopping”)';
    var done = function (name, reason) {
      return {
        name: name,
        reason: reason.charAt(0).toUpperCase() + reason.slice(1) + '.',
        kind: name === 'Unassigned' ? 'unassigned' : 'ok'
      };
    };

    if (s === '(direct)' && (m === '(not set)' || m === '(none)')) {
      return done('Direct', 'source “(direct)” without a medium is how GA4 records direct visits');
    }
    if (c.indexOf('cross-network') !== -1) return done('Cross-network', 'the campaign name contains “cross-network”');
    if ((cat === 'shopping' || shop) && paid) {
      return done('Paid Shopping', (cat === 'shopping' ? listed('shopping') : shopText) + ' and ' + paidText);
    }
    if (cat === 'search' && paid) return done('Paid Search', listed('search') + ' and ' + paidText);
    if (cat === 'social' && paid) return done('Paid Social', listed('social') + ' and ' + paidText);
    if (cat === 'video' && paid) return done('Paid Video', listed('video') + ' and ' + paidText);
    if (inList(DISPLAY_MEDIUMS, m)) {
      return done('Display', 'the medium ' + q(m) + ' is one of GA4’s display mediums (display, banner, expandable, interstitial, cpm)');
    }
    if (paid) return done('Paid Other', paidText + ', but ' + q(s) + ' is not on Google’s search, social, video or shopping lists');
    if (cat === 'shopping') return done('Organic Shopping', listed('shopping'));
    if (shop) return done('Organic Shopping', shopText);
    if (cat === 'social') return done('Organic Social', listed('social'));
    if (inList(SOCIAL_MEDIUMS, m)) return done('Organic Social', 'the medium ' + q(m) + ' is one of GA4’s social mediums');
    if (cat === 'video') return done('Organic Video', listed('video'));
    if (VIDEO_MEDIUM_RE.test(m)) return done('Organic Video', 'the medium ' + q(m) + ' contains “video”');
    if (cat === 'search') return done('Organic Search', listed('search'));
    if (m === 'organic') return done('Organic Search', 'the medium is “organic”');
    if (m === 'ai-assistant') return done('AI Assistant', 'GA4 reserves the medium “ai-assistant” for visits from AI assistants');
    if (inList(REFERRAL_MEDIUMS, m)) {
      return done('Referral', 'the medium ' + q(m) + ' is one of GA4’s referral mediums (referral, app, link)');
    }
    if (inList(EMAIL_VALUES, m)) return done('Email', 'the medium ' + q(m) + ' is one of GA4’s email values');
    if (inList(EMAIL_VALUES, s)) return done('Email', 'the source ' + q(s) + ' is one of GA4’s email values');
    if (m === 'affiliate') return done('Affiliates', 'the medium is “affiliate”');
    if (m === 'audio') return done('Audio', 'the medium is “audio”');
    if (m === 'sms') return done('SMS', 'the medium is “sms”');
    if (s === 'sms') return done('SMS', 'the source is “sms”');
    if (/push$/.test(m)) return done('Mobile Push Notifications', 'the medium ' + q(m) + ' ends with “push”');
    if (m.indexOf('mobile') !== -1 || m.indexOf('notification') !== -1) {
      return done('Mobile Push Notifications', 'the medium ' + q(m) + ' contains “' +
        (m.indexOf('mobile') !== -1 ? 'mobile' : 'notification') + '”');
    }
    if (s === 'firebase') return done('Mobile Push Notifications', 'the source is “firebase”');
    return done('Unassigned', 'no default channel rule matches source ' + q(s) + ' with medium ' + q(m));
  }

  // True when GA4 (or this tool's offline list) treats the value as a medium
  function isKnownMedium(m) {
    m = lowerTrim(m);
    if (!m) return false;
    return PAID_RE.test(m) || inList(DISPLAY_MEDIUMS, m) || inList(SOCIAL_MEDIUMS, m) ||
      VIDEO_MEDIUM_RE.test(m) || m === 'organic' || m === 'ai-assistant' || inList(REFERRAL_MEDIUMS, m) ||
      inList(EMAIL_VALUES, m) || m === 'affiliate' || m === 'audio' || m === 'sms' || /push$/.test(m) ||
      m.indexOf('mobile') !== -1 || m.indexOf('notification') !== -1 || inList(OFFLINE_MEDIUMS, m);
  }

  function paidMediumFor(cat) {
    if (cat === 'social') return 'paid_social';
    if (cat === 'video') return 'paid_video';
    return 'cpc';
  }

  // At most one message about the medium
  function mediumAdvice(s, m, c, current) {
    if (!m) return null;
    var cat = sourceCategory(s);
    var mcat = sourceCategory(m);

    if (mcat && !isKnownMedium(m)) {
      var tip = {
        social: 'social (posts) or paid_social (ads)',
        search: 'organic (listings) or cpc (ads)',
        video: 'video (organic) or paid_video (ads)',
        shopping: 'organic (listings) or cpc (ads)'
      }[mcat];
      var text = '“' + m + '” is a source, not a medium. ' + (s ? 'Use a medium such as ' + tip + '.' :
        'Put it in Campaign source and use a medium such as ' + tip + '.');
      var fix = mcat === 'social' ? 'social' : mcat === 'video' ? 'video' : '';
      var action = fix ? { id: 'set', field: 'medium', value: fix, move: !s,
        label: s ? 'Use “' + fix + '”' : 'Move it to source, use “' + fix + '”' } : null;
      return msg('warn', text, action);
    }

    var fix2 = own(MEDIUM_FIXES, m);
    if (current === 'Unassigned' && fix2) {
      return msg('warn', 'GA4 doesn’t recognise the medium “' + m + '”, so these visits would be Unassigned. Use “' +
        fix2 + '” so they count as ' + predictChannel(s, fix2, c).name + '.',
        { id: 'set', field: 'medium', value: fix2, label: 'Use “' + fix2 + '”' });
    }

    var tokens = m.split(/[\s_.\-]+/);
    var hinted = tokens.some(function (t) { return inList(PAID_HINTS, t); });
    if (hinted && !PAID_RE.test(m)) {
      var paidFix = paidMediumFor(cat);
      return msg('warn', 'The medium “' + m + '” doesn’t match GA4’s paid pattern (cpc, ppc, retargeting, paid…), so these ad clicks would count as ' +
        current + '. Use “' + paidFix + '” so they count as ' + predictChannel(s, paidFix, c).name + '.',
        { id: 'set', field: 'medium', value: paidFix, label: 'Use “' + paidFix + '”' });
    }

    if (current === 'Unassigned') {
      if (inList(OFFLINE_MEDIUMS, m)) {
        return msg('info', 'GA4 has no default channel for offline mediums such as “' + m + '”. The visits show as Unassigned in channel reports but keep their exact source / medium; create a custom channel group in GA4 if you want an offline channel.');
      }
      return msg('warn', 'No GA4 default channel rule matches this source and medium, so the visits would be Unassigned. Mediums GA4 recognises include email, social, cpc, display, affiliate, referral, organic, video, audio and sms.');
    }
    return null;
  }

  function platformIn(s) {
    for (var i = 0; i < PLATFORM_NAMES.length; i++) {
      var name = PLATFORM_NAMES[i];
      if (new RegExp('(^|[^a-z])' + name + '([^a-z]|$)').test(s)) return name;
    }
    return '';
  }

  // Suggest the listed spelling of a platform when it changes the channel
  function sourceAdvice(s, m, c, current) {
    if (!s || sourceCategory(s)) return null;
    var alias = own(SOURCE_ALIASES, s);
    var alt = alias || platformIn(s);
    if (!alt || alt === s) return null;
    var altChannel = predictChannel(alt, m, c).name;
    if (altChannel === current) return null;
    var why = alias ? 'GA4’s source list knows “' + alt + '” but not “' + s + '”' :
      'GA4 recognises the plain name “' + alt + '”, not “' + s + '”';
    return msg('warn', why + ': with source “' + alt + '” these visits count as ' + altChannel + ' instead of ' + current +
      '. Put details such as the page or ad format in utm_content.',
      { id: 'set', field: 'source', value: alt, label: 'Use “' + alt + '”' });
  }

  // Campaign names that override the channel
  function campaignAdvice(s, m, c, current) {
    if (!c) return null;
    var neutral = predictChannel(s, m, '').name;
    if (neutral === current) return null;
    if (c.indexOf('cross-network') !== -1) {
      return msg('warn', 'GA4 files every campaign whose name contains “cross-network” under Cross-network, so these visits would not count as ' +
        neutral + '. Rename the campaign unless that is intended.');
    }
    if (SHOP_CAMPAIGN_RE.test(c)) {
      return msg('warn', 'GA4 treats campaign names containing “shop” or “shopping” as shopping campaigns: these visits would count as ' +
        current + ' instead of ' + neutral + '. Rename the campaign (for example “store” instead of “shop”) unless that is intended.');
    }
    return null;
  }

  function isSwapped(s, m) {
    return !!m && inList(MEDIUM_WORDS, s) && !inList(MEDIUM_WORDS, m) && !isKnownMedium(m);
  }

  // GA4-specific tips for a source / medium / campaign combination
  function adviceMessages(values, channel) {
    var s = lowerTrim(values.source);
    var m = lowerTrim(values.medium);
    var c = lowerTrim(values.campaign);
    var current = channel ? channel.name : predictChannel(s, m, c).name;
    var out = [];
    var med = mediumAdvice(s, m, c, current);
    if (med) out.push(med);
    var src = sourceAdvice(s, m, c, current);
    if (src) out.push(src);
    var camp = campaignAdvice(s, m, c, current);
    if (camp) out.push(camp);
    if (!med && isSwapped(s, m)) {
      out.push(msg('info', 'Source and medium look swapped. The source says where the visit comes from (newsletter, facebook); the medium says what kind of channel it is (email, social).',
        { id: 'swap', label: 'Swap them' }));
    }
    return out;
  }

  // ── Link builder ────────────────────────────────────────

  function textOnly(p) {
    return segmentValue(p.value, true).filter(function (seg) { return !seg.macro; })
      .map(function (seg) { return seg.text; }).join('');
  }

  function sortMessages(list) {
    var rank = { error: 0, warn: 1, info: 2 };
    return list.map(function (m, i) { return { m: m, i: i }; })
      .sort(function (a, b) { return (rank[a.m.level] - rank[b.m.level]) || (a.i - b.i); })
      .map(function (x) { return x.m; });
  }

  // Build the tagged link. Returns { ready, url, query, params[], values, base, channel, macros, messages[] }
  function buildLink(input, options) {
    input = input || {};
    options = normalizeOptions(options);
    var params = [];
    var stripped = [];
    PARAMS.forEach(function (p) {
      var raw = str(input[p.field]).trim();
      if (!raw) return;
      var n = normalizeValue(raw, options);
      if (n.stripped) stripped.push({ label: p.label, prefix: n.stripped });
      if (!n.value) return;
      var segments = encodeSegments(n.value, options.macros);
      params.push({
        key: p.key, field: p.field, label: p.label, raw: raw, value: n.value,
        segments: segments,
        encoded: segments.map(function (seg) { return seg.text; }).join(''),
        macros: n.macros
      });
    });

    var values = {};
    FIELDS.forEach(function (f) { values[f] = ''; });
    params.forEach(function (p) { values[p.field] = p.value; });

    var pairs = params.map(function (p) { return p.key + '=' + p.encoded; });
    var base = parseBaseUrl(input.url);
    var ready = base.ok && !!values.source;
    var macros = params.some(function (p) { return p.macros.length > 0; });

    var channel = null;
    if (values.source || values.medium) {
      var placeholder = segmentValue(values.source + ' ' + values.medium, options.macros)
        .filter(function (seg) { return seg.macro; })[0];
      channel = placeholder ? {
        name: 'Set by the ad platform',
        reason: 'GA4 classifies the value the ad platform puts in place of ' + placeholder.text + '.',
        kind: 'depends'
      } : predictChannel(values.source, values.medium, values.campaign);
    }

    var r = {
      ready: ready,
      url: ready ? base.origin + base.path + '?' + base.kept.concat(pairs).join('&') + base.fragment : '',
      query: pairs.join('&'),
      params: params,
      values: values,
      base: base,
      channel: channel,
      macros: macros
    };
    r.messages = collectMessages(r, options, stripped);
    return r;
  }

  function collectMessages(r, options, stripped) {
    var out = [];
    var add = function (level, text, action) { out.push(msg(level, text, action)); };
    var v = r.values;
    var hasParams = r.params.length > 0;

    if (r.base.error) add('error', r.base.error);
    r.base.messages.forEach(function (m) { out.push(m); });

    if (!v.source && (hasParams || r.base.ok)) {
      add('error', 'Add a campaign source (utm_source). It names where the visit comes from and is needed to build the link.');
    }
    if (v.source && !v.medium) add('warn', 'Add a campaign medium (utm_medium). Without it GA4 reports the medium as (not set).');
    if (v.source && !v.campaign) add('warn', 'Add a campaign name (utm_campaign). Without it GA4 reports the campaign as (not set).');
    if (hasParams && r.base.empty) {
      add('info', 'No website URL yet. You can already copy the parameters into an ad platform field such as Meta’s “URL parameters” or the Google Ads “Final URL suffix”.');
    }
    stripped.forEach(function (x) {
      add('info', 'Removed “' + x.prefix + '=” from ' + x.label + ': type only the value.');
    });

    if (r.channel && r.channel.kind !== 'depends') {
      adviceMessages(v, r.channel).forEach(function (m) { out.push(m); });
    }

    var texts = r.params.map(textOnly);
    if (!options.lowercase && texts.some(function (t) { return t !== t.toLowerCase(); })) {
      add('warn', 'GA4 values are case-sensitive: utm_source=Facebook and utm_source=facebook are reported as two sources. Turn on “Lowercase values” to keep reports tidy.');
    }
    if (options.spaces === 'keep' && texts.some(function (t) { return /\s/.test(t); })) {
      add('info', 'Spaces are sent as %20. Replacing them with _ or - keeps links easier to read.');
    }
    if (texts.some(function (t) { return /[&=?#\/+%]/.test(t); })) {
      add('info', 'Characters such as & = ? # / are percent-encoded so they can’t break the link.');
    }
    if (texts.some(function (t) { return /[^\x00-\x7f]/.test(t); })) {
      add('info', 'Non-Latin characters are sent percent-encoded as UTF-8; GA4 shows them decoded.');
    }
    if (r.macros) {
      var found = [];
      r.params.forEach(function (p) {
        p.macros.forEach(function (x) { if (!inList(found, x)) found.push(x); });
      });
      add('info', 'Kept ' + found.join(', ') + ' as ' + (found.length === 1 ? 'it is' : 'they are') +
        ', so the ad platform can fill ' + (found.length === 1 ? 'it' : 'them') +
        ' in. Paste this link into the ad platform, not into posts or QR codes.');
    }
    if (v.format || v.tactic) {
      add('info', 'Google Analytics doesn’t currently report utm_creative_format or utm_marketing_tactic; the values still travel with the link.');
    }
    if (r.url.length > 2000) {
      add('warn', 'This link is ' + r.url.length + ' characters long. Some apps and SMS gateways cut very long links, so shorten the values or the URL.');
    }
    return sortMessages(out);
  }

  // ── CSV, file names, SVG ────────────────────────────────

  var CSV_COLUMNS = ['url', 'landing_page', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term',
    'utm_content', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic', 'ga4_channel', 'added'];

  // Quote when needed; prefix cells a spreadsheet would run as a formula
  function csvCell(v) {
    var s = str(v);
    if (/^[=+\-@\t\r]/.test(s)) s = '\'' + s;
    if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv(entries) {
    var rows = [CSV_COLUMNS.join(',')];
    (entries || []).forEach(function (e) {
      rows.push([e.url, e.landing, e.source, e.medium, e.campaign, e.id, e.term, e.content,
        e.platform, e.format, e.tactic, e.channel, e.added].map(csvCell).join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }

  // ASCII-only file name fragment
  function fileSlug(value) {
    return str(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');
  }

  // Build an SVG from a module matrix ({ count, modules[row][col] }).
  // Horizontal runs of dark modules are merged into single path segments.
  function buildSvg(matrix, quiet, pixelSize) {
    var total = matrix.count + quiet * 2;
    var d = '';
    for (var r = 0; r < matrix.count; r++) {
      var c = 0;
      while (c < matrix.count) {
        if (!matrix.modules[r][c]) { c++; continue; }
        var start = c;
        while (c < matrix.count && matrix.modules[r][c]) c++;
        var run = c - start;
        d += 'M' + (start + quiet) + ' ' + (r + quiet) + 'h' + run + 'v1h-' + run + 'z';
      }
    }
    var px = pixelSize || total * 10;
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" ' +
      'width="' + px + '" height="' + px + '" shape-rendering="crispEdges">\n' +
      '<rect width="' + total + '" height="' + total + '" fill="#ffffff"/>\n' +
      '<path fill="#000000" d="' + d + '"/>\n' +
      '</svg>\n';
  }

  // UTF-8 encode into a "byte string" (one char per byte) for the QR library's Byte mode
  function toUtf8ByteString(s) {
    s = wellFormed(s);
    if (typeof TextEncoder !== 'undefined') {
      var bytes = new TextEncoder().encode(s);
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
    return unescape(encodeURIComponent(s));
  }

  // ── Storage ─────────────────────────────────────────────

  function storageGet(key) {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable (private mode, blocked cookies, quota) */ }
  }

  function storageRemove(key) {
    try {
      if (window.localStorage) window.localStorage.removeItem(key);
    } catch (e) { /* ignore */ }
  }

  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function pickStrings(obj, keys, max) {
    var out = {};
    keys.forEach(function (k) {
      out[k] = obj && typeof obj[k] === 'string' ? obj[k].slice(0, max) : '';
    });
    return out;
  }

  function loadSaved() {
    var data = parseJson(storageGet(STORE_PRESETS));
    if (!data || !Array.isArray(data.items)) return [];
    return data.items.filter(function (p) {
      return p && typeof p.name === 'string' && p.name.trim() && p.fields && typeof p.fields === 'object';
    }).slice(0, MAX_PRESETS).map(function (p) {
      return { name: p.name.trim().slice(0, 60), fields: pickStrings(p.fields, FIELDS, 500) };
    });
  }

  function storeSaved() {
    storageSet(STORE_PRESETS, JSON.stringify({ v: 1, items: state.saved }));
  }

  function loadLinks() {
    var data = parseJson(storageGet(STORE_LINKS));
    if (!data || !Array.isArray(data.items)) return [];
    var keys = ['url', 'landing', 'channel', 'added'].concat(FIELDS);
    return data.items.filter(function (e) {
      return e && typeof e.url === 'string' && /^https?:\/\//i.test(e.url);
    }).slice(-MAX_LINKS).map(function (e) {
      return pickStrings(e, keys, 4000);
    });
  }

  function storeLinks() {
    storageSet(STORE_LINKS, JSON.stringify({ v: 1, items: state.links }));
  }

  // ── State ───────────────────────────────────────────────

  var state = {
    result: null,
    options: normalizeOptions(),
    presetApplied: null,
    qrMatrix: null,
    qrFailed: false,
    saved: [],
    links: []
  };
  var updateTimer = null;
  var draftTimer = null;
  var toastTimer = null;
  var confirmTimers = {};

  function readForm() {
    var input = { url: $('ucb-url').value };
    FIELDS.forEach(function (f) { input[f] = $('ucb-' + f).value; });
    return input;
  }

  function readOptions() {
    return normalizeOptions({
      lowercase: $('ucb-lower').checked,
      spaces: $('ucb-spaces').value,
      macros: $('ucb-macros').checked
    });
  }

  function setFields(values) {
    if (typeof values.url === 'string') $('ucb-url').value = values.url;
    FIELDS.forEach(function (f) {
      if (typeof values[f] === 'string') $('ucb-' + f).value = values[f];
    });
    if (['id', 'platform', 'format', 'tactic'].some(function (f) { return $('ucb-' + f).value.trim(); })) {
      $('ucb-more').open = true;
    }
  }

  function isParamField(id) {
    return id.indexOf('ucb-') === 0 && inList(FIELDS, id.slice(4));
  }

  // ── Rendering ───────────────────────────────────────────

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 120);
  }

  function update() {
    clearTimeout(updateTimer);
    state.options = readOptions();
    var r = buildLink(readForm(), state.options);
    state.result = r;
    renderPreview(r);
    renderParams(r);
    renderMessages(r.messages);
    renderChannel(r);
    $('ucb-btn-copy').disabled = !r.ready;
    $('ucb-btn-open').disabled = !r.ready;
    $('ucb-btn-add').disabled = !r.ready;
    $('ucb-btn-copy-params').disabled = !r.query;
    updateQr();
    scheduleDraftSave();
  }

  function placeholderText(r) {
    if (r.base.error) return 'Fix the website URL to build the link.';
    if (r.base.ok && !r.values.source) return 'Add a campaign source (utm_source) to build the link.';
    return 'Enter a website URL and a campaign source to build the link.';
  }

  function renderPreview(r) {
    var box = $('ucb-preview');
    var status = $('ucb-status');
    box.textContent = '';
    if (!r.ready && !r.query) {
      box.appendChild(el('span', 'ucb-preview-placeholder', placeholderText(r)));
      box.classList.add('ucb-preview--empty');
      status.textContent = '';
      return;
    }
    box.classList.remove('ucb-preview--empty');
    var parts = [];
    if (r.ready) {
      parts.push(['ucb-url-base', r.base.origin + r.base.path]);
      parts.push(['ucb-url-sep', '?']);
      r.base.kept.forEach(function (pair) {
        parts.push(['ucb-url-kept', pair]);
        parts.push(['ucb-url-sep', '&']);
      });
    }
    r.params.forEach(function (p, i) {
      if (i) parts.push(['ucb-url-sep', '&']);
      parts.push(['ucb-url-key', p.key]);
      parts.push(['ucb-url-sep', '=']);
      p.segments.forEach(function (seg) {
        parts.push([seg.macro ? 'ucb-url-macro' : 'ucb-url-val', seg.text]);
      });
    });
    if (r.ready && r.base.fragment) parts.push(['ucb-url-frag', r.base.fragment]);
    parts.forEach(function (part) { box.appendChild(el('span', part[0], part[1])); });

    var tags = r.params.length + ' UTM ' + (r.params.length === 1 ? 'tag' : 'tags');
    status.textContent = r.ready ? r.url.length + ' characters · ' + tags :
      'Parameters only · ' + r.query.length + ' characters · ' + tags;
  }

  function renderParams(r) {
    var wrap = $('ucb-params-wrap');
    var box = $('ucb-params');
    box.textContent = '';
    wrap.classList.toggle('ucb-hidden', !r.params.length);
    if (!r.params.length) return;

    var head = el('div', 'ucb-param-row ucb-param-row--head');
    head.setAttribute('role', 'row');
    ['Parameter', 'In GA4 reports', 'In the URL'].forEach(function (t) {
      var cell = el('div', 'ucb-param-cell', t);
      cell.setAttribute('role', 'columnheader');
      head.appendChild(cell);
    });
    box.appendChild(head);

    r.params.forEach(function (p) {
      var row = el('div', 'ucb-param-row');
      row.setAttribute('role', 'row');
      var key = el('div', 'ucb-param-cell ucb-param-key', p.key);
      var val = el('div', 'ucb-param-cell ucb-param-val');
      var enc = el('div', 'ucb-param-cell ucb-param-enc', p.encoded);
      val.appendChild(el('span', 'ucb-param-main', p.value));
      if (p.raw !== p.value) val.appendChild(el('span', 'ucb-param-raw', 'typed: ' + p.raw));
      [key, val, enc].forEach(function (cell) {
        cell.setAttribute('role', 'cell');
        row.appendChild(cell);
      });
      box.appendChild(row);
    });
  }

  function renderMessages(list) {
    var ul = $('ucb-messages');
    ul.textContent = '';
    list.forEach(function (m) {
      var li = el('li', 'ucb-msg' + (m.level === 'error' ? ' ucb-msg--error' : m.level === 'warn' ? ' ucb-msg--warn' : ''));
      li.appendChild(el('span', 'ucb-msg-text', m.text));
      if (m.action) {
        var btn = el('button', 'ucb-msg-action', m.action.label);
        btn.type = 'button';
        btn.setAttribute('data-action', m.action.id);
        if (m.action.field) btn.setAttribute('data-field', m.action.field);
        if (m.action.value != null) btn.setAttribute('data-value', m.action.value);
        if (m.action.move) btn.setAttribute('data-move', '1');
        li.appendChild(btn);
      }
      ul.appendChild(li);
    });
  }

  function renderChannel(r) {
    var badge = $('ucb-channel-badge');
    var why = $('ucb-channel-why');
    var report = $('ucb-report');
    var ch = r.channel;
    report.textContent = '';
    if (!ch) {
      badge.className = 'ucb-channel-badge ucb-channel-badge--idle';
      badge.textContent = 'Waiting for source and medium';
      why.textContent = 'Add a source and medium to see which GA4 default channel group the visits will count toward.';
      report.classList.add('ucb-hidden');
      return;
    }
    badge.className = 'ucb-channel-badge ' + (ch.kind === 'unassigned' ? 'ucb-channel-badge--warn' :
      ch.kind === 'depends' ? 'ucb-channel-badge--info' : 'ucb-channel-badge--ok');
    badge.textContent = ch.name;
    why.textContent = ch.reason;

    var v = r.values;
    // Placeholders are replaced by the ad platform before GA4 sees the value
    var shown = function (value) {
      if (!value) return '(not set)';
      var macro = segmentValue(value, state.options.macros).some(function (seg) { return seg.macro; });
      return macro ? value + ' (filled in by the ad platform)' : value;
    };
    var rows = [
      ['Session source / medium', shown(v.source) + ' / ' + shown(v.medium)],
      ['Session campaign', shown(v.campaign)]
    ];
    if (v.content) rows.push(['Session manual ad content', shown(v.content)]);
    if (v.term) rows.push(['Session manual term', shown(v.term)]);
    rows.forEach(function (row) {
      var line = el('div', 'ucb-report-row');
      line.appendChild(el('span', 'ucb-report-key', row[0]));
      line.appendChild(el('span', 'ucb-report-val', row[1]));
      report.appendChild(line);
    });
    report.classList.remove('ucb-hidden');
  }

  // ── QR code ─────────────────────────────────────────────

  function ensureQrLib(onReady) {
    if (typeof window.qrcode === 'function') { onReady(); return; }
    if (state.qrFailed) return;
    if (window.__ucbQrLoading) { window.__ucbQrLoading.push(onReady); return; }
    window.__ucbQrLoading = [onReady];
    var script = document.createElement('script');
    script.src = QR_LIB_URL;
    script.async = true;
    script.onload = function () {
      var queue = window.__ucbQrLoading || [];
      window.__ucbQrLoading = null;
      queue.forEach(function (cb) {
        try { cb(); } catch (err) { console.error(err); }
      });
    };
    script.onerror = function () {
      window.__ucbQrLoading = null;
      state.qrFailed = true;
      showQrPlaceholder('Could not load the QR code library from the CDN. Check your connection and reload the page.');
    };
    (document.head || document.body).appendChild(script);
  }

  // Encode text as UTF-8 bytes. The library's default converter keeps one byte per
  // char, so feeding it a UTF-8 byte string gives correct output for any URL.
  function makeMatrix(text, ecl) {
    var lib = window.qrcode;
    var saved = lib.stringToBytes;
    if (lib.stringToBytesFuncs && lib.stringToBytesFuncs['default']) {
      lib.stringToBytes = lib.stringToBytesFuncs['default'];
    }
    var qr;
    try {
      qr = lib(0, ecl);
      qr.addData(toUtf8ByteString(text), 'Byte');
      qr.make();
    } finally {
      lib.stringToBytes = saved;
    }
    var count = qr.getModuleCount();
    var modules = [];
    for (var r = 0; r < count; r++) {
      var row = [];
      for (var c = 0; c < count; c++) row.push(qr.isDark(r, c));
      modules.push(row);
    }
    return { count: count, modules: modules, version: (count - 17) / 4 };
  }

  // Draw the matrix into a size×size square at (x, y). Module edges are rounded
  // to whole pixels so every module stays crisp at any output size.
  function drawQr(ctx, matrix, x, y, size, quiet) {
    var total = matrix.count + quiet * 2;
    var edge = function (i) { return Math.round(i * size / total); };
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < matrix.count; r++) {
      var y0 = edge(r + quiet);
      var y1 = edge(r + quiet + 1);
      var c = 0;
      while (c < matrix.count) {
        if (!matrix.modules[r][c]) { c++; continue; }
        var start = c;
        while (c < matrix.count && matrix.modules[r][c]) c++;
        ctx.fillRect(x + edge(start + quiet), y + y0, edge(c + quiet) - edge(start + quiet), y1 - y0);
      }
    }
  }

  function setQrButtons(ready) {
    $('ucb-btn-png').disabled = !ready;
    $('ucb-btn-svg').disabled = !ready;
  }

  function showQrPlaceholder(text) {
    state.qrMatrix = null;
    $('ucb-qr-canvas').classList.add('ucb-hidden');
    var ph = $('ucb-qr-placeholder');
    ph.textContent = text;
    ph.classList.remove('ucb-hidden');
    $('ucb-qr-status').textContent = '';
    var note = $('ucb-qr-note');
    note.textContent = '';
    note.classList.add('ucb-hidden');
    setQrButtons(false);
  }

  function updateQr() {
    var r = state.result;
    if (!r || !r.ready) {
      var text = 'The QR code appears once the link is ready.';
      if (r && r.base.error) text = 'Fix the website URL to generate the QR code.';
      else if (r && r.base.ok && !r.values.source) text = 'Add a campaign source to generate the QR code.';
      else if (r && r.base.empty && r.query) text = 'Add the website URL to generate the QR code.';
      showQrPlaceholder(text);
      return;
    }
    if (state.qrFailed) return;
    ensureQrLib(renderQr);
  }

  function renderQr() {
    var r = state.result;
    if (!r || !r.ready) return;
    var ecl = $('ucb-ecl').value;
    var matrix;
    try {
      matrix = makeMatrix(r.url, ecl);
    } catch (err) {
      showQrPlaceholder('This link is too long for a QR code at error correction ' + ecl + '. Choose a lower level or shorten the link.');
      return;
    }
    state.qrMatrix = matrix;

    var canvas = $('ucb-qr-canvas');
    var dpr = window.devicePixelRatio || 1;
    var px = Math.round(240 * Math.min(Math.max(dpr, 1), 3));
    canvas.width = px;
    canvas.height = px;
    drawQr(canvas.getContext('2d'), matrix, 0, 0, px, QUIET);
    canvas.classList.remove('ucb-hidden');
    $('ucb-qr-placeholder').classList.add('ucb-hidden');

    $('ucb-qr-status').textContent = 'Version ' + matrix.version + ' · ' + matrix.count + '×' + matrix.count +
      ' modules · ' + r.url.length + ' characters · ECL ' + ecl;
    var text = '';
    if (r.macros) {
      text = 'The link contains ad-platform placeholders. A printed code would contain them as literal text.';
    } else if (matrix.version >= 10) {
      text = 'Dense code (version ' + matrix.version + '). Print it large, or shorten the values or the URL so it scans easily.';
    }
    var note = $('ucb-qr-note');
    note.textContent = text;
    note.classList.toggle('ucb-hidden', !text);
    setQrButtons(true);
  }

  // ── Toast, clipboard, downloads ─────────────────────────

  function showToast(text, isError) {
    var toast = $('ucb-toast');
    toast.textContent = text;
    toast.classList.toggle('ucb-toast--error', !!isError);
    toast.classList.add('ucb-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('ucb-show'); }, 2000);
  }

  function copyText(text, okMsg) {
    var fallback = function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      showToast(ok ? okMsg : 'Copy failed — select the text and copy it manually', !ok);
    };
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () { showToast(okMsg); }).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadHref(filename, href, revoke) {
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
  }

  function downloadBlob(filename, blob) {
    downloadHref(filename, URL.createObjectURL(blob), true);
  }

  function qrFileName(ext) {
    var v = state.result ? state.result.values : {};
    var slug = fileSlug(v.campaign) || fileSlug(v.source);
    return 'utm-qr' + (slug ? '-' + slug : '') + '.' + ext;
  }

  function copyUrl() {
    if (state.result && state.result.ready) copyText(state.result.url, 'Campaign URL copied');
  }

  function copyParams() {
    if (state.result && state.result.query) copyText(state.result.query, 'Parameters copied');
  }

  function openUrl() {
    if (!state.result || !state.result.ready) return;
    window.open(state.result.url, '_blank', 'noopener,noreferrer');
  }

  function downloadPng() {
    if (!state.qrMatrix) return;
    var size = parseInt($('ucb-png-size').value, 10) || 1024;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    drawQr(canvas.getContext('2d'), state.qrMatrix, 0, 0, size, QUIET);
    var name = qrFileName('png');
    if (canvas.toBlob) {
      canvas.toBlob(function (blob) { downloadBlob(name, blob); }, 'image/png');
    } else {
      downloadHref(name, canvas.toDataURL('image/png'), false);
    }
    showToast('PNG downloaded (' + size + '×' + size + ')');
  }

  function downloadSvg() {
    if (!state.qrMatrix) return;
    downloadBlob(qrFileName('svg'), new Blob([buildSvg(state.qrMatrix, QUIET)], { type: 'image/svg+xml;charset=utf-8' }));
    showToast('SVG downloaded');
  }

  // ── Two-click confirm for destructive buttons ───────────

  function confirmClick(btn, label, confirmLabel, action) {
    var key = btn.id;
    if (btn.getAttribute('data-confirm') === '1') {
      clearTimeout(confirmTimers[key]);
      btn.removeAttribute('data-confirm');
      btn.classList.remove('ucb-confirm');
      btn.textContent = label;
      action();
      return;
    }
    btn.setAttribute('data-confirm', '1');
    btn.classList.add('ucb-confirm');
    btn.textContent = confirmLabel;
    confirmTimers[key] = setTimeout(function () {
      btn.removeAttribute('data-confirm');
      btn.classList.remove('ucb-confirm');
      btn.textContent = label;
    }, 3000);
  }

  // ── Presets ─────────────────────────────────────────────

  function findPreset(id) {
    for (var g = 0; g < PRESETS.length; g++) {
      for (var i = 0; i < PRESETS[g].items.length; i++) {
        if (PRESETS[g].items[i].id === id) return PRESETS[g].items[i];
      }
    }
    return null;
  }

  function populatePresets(selected) {
    var sel = $('ucb-preset');
    sel.textContent = '';
    var first = el('option', null, 'Choose a preset…');
    first.value = '';
    sel.appendChild(first);
    var addGroup = function (label, items) {
      var group = document.createElement('optgroup');
      group.label = label;
      items.forEach(function (item) {
        var opt = el('option', null, item.label);
        opt.value = item.value;
        group.appendChild(opt);
      });
      sel.appendChild(group);
    };
    if (state.saved.length) {
      addGroup('Your presets', state.saved.map(function (p, i) { return { value: 's:' + i, label: p.name }; }));
    }
    PRESETS.forEach(function (g) {
      addGroup(g.group, g.items.map(function (p) { return { value: 'b:' + p.id, label: p.label }; }));
    });
    sel.value = selected || '';
  }

  function setPresetHint(text) {
    $('ucb-preset-hint').textContent = text || DEFAULT_PRESET_HINT;
  }

  function resetPresetUi() {
    state.presetApplied = null;
    $('ucb-preset').value = '';
    $('ucb-preset-delete').classList.add('ucb-hidden');
    setPresetHint('');
  }

  function applyPreset(value) {
    var set = null;
    var compare = null;
    var note = '';
    if (value.indexOf('b:') === 0) {
      var p = findPreset(value.slice(2));
      if (p) {
        set = { source: p.source, medium: p.medium };
        compare = p.source ? set : { medium: p.medium };
        note = p.note || '';
      }
    } else if (value.indexOf('s:') === 0) {
      var saved = state.saved[parseInt(value.slice(2), 10)];
      if (saved) {
        set = {};
        FIELDS.forEach(function (f) { set[f] = saved.fields[f] || ''; });
        compare = set;
        note = 'Saved in this browser.';
      }
    }
    if (!set) {
      resetPresetUi();
      return;
    }
    setFields(set);
    state.presetApplied = { value: value, compare: compare };
    setPresetHint(note);
    $('ucb-preset-delete').classList.toggle('ucb-hidden', value.indexOf('s:') !== 0);
    update();
    if (!set.source) $('ucb-source').focus();
  }

  // Leave the preset selected only while the form still matches it
  function checkPresetMatch() {
    var ap = state.presetApplied;
    if (!ap) return;
    var changed = Object.keys(ap.compare).some(function (f) {
      return $('ucb-' + f).value !== ap.compare[f];
    });
    if (changed) resetPresetUi();
  }

  function presetSaveStart() {
    var v = state.result ? state.result.values : {};
    var name = v.campaign || [v.source, v.medium].filter(Boolean).join(' / ');
    $('ucb-preset-form').classList.remove('ucb-hidden');
    var input = $('ucb-preset-name');
    input.value = name.slice(0, 60);
    input.focus();
    input.select();
  }

  function presetSaveCancel() {
    $('ucb-preset-form').classList.add('ucb-hidden');
  }

  function presetSaveConfirm() {
    var name = $('ucb-preset-name').value.trim().slice(0, 60);
    if (!name) {
      showToast('Give the preset a name', true);
      $('ucb-preset-name').focus();
      return;
    }
    var input = readForm();
    var fields = {};
    FIELDS.forEach(function (f) { fields[f] = input[f].trim(); });
    if (!FIELDS.some(function (f) { return fields[f]; })) {
      showToast('Fill in at least one field first', true);
      return;
    }
    var idx = -1;
    state.saved.forEach(function (p, i) {
      if (p.name.toLowerCase() === name.toLowerCase()) idx = i;
    });
    if (idx === -1) {
      if (state.saved.length >= MAX_PRESETS) {
        showToast('You can keep up to ' + MAX_PRESETS + ' presets', true);
        return;
      }
      state.saved.push({ name: name, fields: fields });
      idx = state.saved.length - 1;
    } else {
      state.saved[idx] = { name: name, fields: fields };
    }
    storeSaved();
    populatePresets('s:' + idx);
    state.presetApplied = { value: 's:' + idx, compare: fields };
    presetSaveCancel();
    $('ucb-preset-delete').classList.remove('ucb-hidden');
    setPresetHint('Saved in this browser.');
    showToast('Preset saved');
  }

  function presetDelete() {
    var ap = state.presetApplied;
    if (!ap || ap.value.indexOf('s:') !== 0) return;
    confirmClick($('ucb-preset-delete'), 'Delete', 'Confirm delete', function () {
      var idx = parseInt(ap.value.slice(2), 10);
      if (!state.saved[idx]) return;
      state.saved.splice(idx, 1);
      storeSaved();
      populatePresets('');
      resetPresetUi();
      showToast('Preset deleted');
    });
  }

  // ── Link list ───────────────────────────────────────────

  function addToList() {
    var r = state.result;
    if (!r || !r.ready) return;
    var exists = state.links.some(function (e) { return e.url === r.url; });
    if (exists) {
      showToast('Already in the list');
      return;
    }
    var entry = {
      url: r.url,
      landing: cleanUrl(r.base),
      channel: r.channel ? r.channel.name : '',
      added: new Date().toISOString()
    };
    FIELDS.forEach(function (f) { entry[f] = r.values[f]; });
    state.links.push(entry);
    if (state.links.length > MAX_LINKS) state.links = state.links.slice(-MAX_LINKS);
    storeLinks();
    renderList();
    showToast('Added to the list (' + state.links.length + ')');
  }

  function listButton(action, index, text, label, extra) {
    var btn = el('button', 'ucb-link-btn' + (extra ? ' ' + extra : ''), text);
    btn.type = 'button';
    btn.setAttribute('data-list-action', action);
    btn.setAttribute('data-index', String(index));
    btn.setAttribute('aria-label', label);
    btn.title = label;
    return btn;
  }

  function renderList() {
    var ul = $('ucb-list');
    var n = state.links.length;
    ul.textContent = '';
    $('ucb-list-count').textContent = String(n);
    $('ucb-list-empty').classList.toggle('ucb-hidden', n > 0);
    ['ucb-list-copy', 'ucb-list-csv', 'ucb-list-clear'].forEach(function (id) { $(id).disabled = !n; });
    state.links.forEach(function (item, i) {
      var li = el('li', 'ucb-list-item');
      var main = el('div', 'ucb-list-main');
      var meta = el('div', 'ucb-list-meta');
      if (item.channel) {
        meta.appendChild(el('span', 'ucb-chip' + (item.channel === 'Unassigned' ? ' ucb-chip--warn' : ''), item.channel));
      }
      meta.appendChild(el('span', 'ucb-list-sm', (item.source || '(not set)') + ' / ' + (item.medium || '(not set)')));
      if (item.campaign) meta.appendChild(el('span', 'ucb-list-camp', item.campaign));
      var url = el('div', 'ucb-list-url', item.url);
      url.title = item.url;
      main.appendChild(meta);
      main.appendChild(url);
      var actions = el('div', 'ucb-list-actions');
      actions.appendChild(listButton('copy', i, 'Copy', 'Copy this link'));
      actions.appendChild(listButton('edit', i, 'Edit', 'Load this link into the form'));
      actions.appendChild(listButton('remove', i, '✕', 'Remove from the list', 'ucb-link-btn--danger'));
      li.appendChild(main);
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }

  function onListAction(e) {
    var btn = e.target.closest ? e.target.closest('[data-list-action]') : null;
    if (!btn) return;
    var i = parseInt(btn.getAttribute('data-index'), 10);
    var item = state.links[i];
    if (!item) return;
    var action = btn.getAttribute('data-list-action');
    if (action === 'copy') {
      copyText(item.url, 'Link copied');
    } else if (action === 'edit') {
      var values = { url: item.landing };
      FIELDS.forEach(function (f) { values[f] = item[f] || ''; });
      setFields(values);
      resetPresetUi();
      update();
      $('ucb-url').focus();
    } else if (action === 'remove') {
      state.links.splice(i, 1);
      storeLinks();
      renderList();
    }
  }

  function listCopyAll() {
    if (!state.links.length) return;
    copyText(state.links.map(function (e) { return e.url; }).join('\n'), state.links.length + ' links copied');
  }

  function listCsv() {
    if (!state.links.length) return;
    var csv = String.fromCharCode(0xFEFF) + buildCsv(state.links);
    var date = new Date().toISOString().slice(0, 10);
    downloadBlob('utm-links-' + date + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    showToast('CSV downloaded');
  }

  function listClear() {
    if (!state.links.length) return;
    confirmClick($('ucb-list-clear'), 'Clear', 'Confirm clear', function () {
      state.links = [];
      storeLinks();
      renderList();
      showToast('List cleared');
    });
  }

  // ── Actions from messages and paste ─────────────────────

  function importTags() {
    var parsed = parseBaseUrl($('ucb-url').value);
    if (!parsed.ok || !parsed.foundCount) return false;
    var values = { url: cleanUrl(parsed) };
    FIELDS.forEach(function (f) { values[f] = ''; });
    PARAMS.forEach(function (p) {
      if (own(parsed.found, p.key) !== undefined) values[p.field] = parsed.found[p.key];
    });
    setFields(values);
    resetPresetUi();
    update();
    showToast('Loaded ' + parsed.foundCount + ' UTM ' + (parsed.foundCount === 1 ? 'tag' : 'tags') + ' into the fields' +
      (parsed.removed.length ? ' · removed ' + parsed.removed.join(', ') : ''));
    return true;
  }

  // A pasted, already tagged link fills an empty form automatically
  function onUrlPaste() {
    setTimeout(function () {
      var input = readForm();
      var empty = FIELDS.every(function (f) { return !input[f].trim(); });
      if (!(empty && importTags())) update();
    }, 0);
  }

  function onMessageAction(e) {
    var btn = e.target.closest ? e.target.closest('.ucb-msg-action') : null;
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (action === 'import') {
      importTags();
      return;
    }
    if (action === 'swap') {
      var source = $('ucb-source').value;
      $('ucb-source').value = $('ucb-medium').value;
      $('ucb-medium').value = source;
    } else if (action === 'set') {
      var field = btn.getAttribute('data-field');
      if (!inList(FIELDS, field)) return;
      if (btn.getAttribute('data-move') === '1' && !$('ucb-source').value.trim()) {
        $('ucb-source').value = $('ucb-medium').value.trim();
      }
      $('ucb-' + field).value = btn.getAttribute('data-value') || '';
    } else {
      return;
    }
    checkPresetMatch();
    update();
  }

  // ── Example, reset, draft and preferences ───────────────

  function loadExample() {
    setFields({
      url: 'https://example.com/spring-sale',
      source: 'newsletter', medium: 'email', campaign: 'Spring Sale 2026',
      id: '', term: '', content: 'header button', platform: '', format: '', tactic: ''
    });
    resetPresetUi();
    update();
  }

  function resetForm() {
    var values = { url: '' };
    FIELDS.forEach(function (f) { values[f] = ''; });
    setFields(values);
    resetPresetUi();
    presetSaveCancel();
    update();
    $('ucb-url').focus();
  }

  function scheduleDraftSave() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function saveDraft() {
    var input = readForm();
    var empty = !input.url.trim() && FIELDS.every(function (f) { return !input[f].trim(); });
    if (empty) storageRemove(STORE_DRAFT);
    else storageSet(STORE_DRAFT, JSON.stringify({ v: 1, input: input }));
  }

  function loadDraft() {
    var data = parseJson(storageGet(STORE_DRAFT));
    if (!data || !data.input || typeof data.input !== 'object') return;
    setFields(pickStrings(data.input, ['url'].concat(FIELDS), 4000));
  }

  function setSelect(id, value) {
    var sel = $(id);
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === value) {
        sel.value = value;
        return;
      }
    }
  }

  function savePrefs() {
    storageSet(STORE_PREFS, JSON.stringify({
      v: 1,
      lowercase: $('ucb-lower').checked,
      spaces: $('ucb-spaces').value,
      macros: $('ucb-macros').checked,
      ecl: $('ucb-ecl').value,
      size: $('ucb-png-size').value
    }));
  }

  function loadPrefs() {
    var p = parseJson(storageGet(STORE_PREFS));
    if (!p || typeof p !== 'object') return;
    if (typeof p.lowercase === 'boolean') $('ucb-lower').checked = p.lowercase;
    if (typeof p.macros === 'boolean') $('ucb-macros').checked = p.macros;
    if (typeof p.spaces === 'string') setSelect('ucb-spaces', p.spaces);
    if (typeof p.ecl === 'string') setSelect('ucb-ecl', p.ecl);
    if (typeof p.size === 'string') setSelect('ucb-png-size', p.size);
  }

  // ── Init ────────────────────────────────────────────────

  function init() {
    var wrapper = document.querySelector('.ucb-wrapper');
    if (!wrapper) return;

    state.saved = loadSaved();
    state.links = loadLinks();
    populatePresets('');
    setPresetHint('');
    loadPrefs();
    loadDraft();
    renderList();

    wrapper.addEventListener('input', function (e) {
      var id = e.target.id || '';
      if (isParamField(id)) checkPresetMatch();
      if (id === 'ucb-url' || isParamField(id)) scheduleUpdate();
    });
    wrapper.addEventListener('change', function (e) {
      var id = e.target.id || '';
      if (id === 'ucb-preset') {
        applyPreset(e.target.value);
      } else if (id === 'ucb-lower' || id === 'ucb-spaces' || id === 'ucb-macros') {
        savePrefs();
        update();
      } else if (id === 'ucb-ecl' || id === 'ucb-png-size') {
        savePrefs();
        updateQr();
      }
    });
    wrapper.addEventListener('keydown', function (e) {
      if (e.target.id === 'ucb-preset-name') {
        if (e.key === 'Enter') { e.preventDefault(); presetSaveConfirm(); }
        if (e.key === 'Escape') { e.preventDefault(); presetSaveCancel(); }
        return;
      }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        e.preventDefault();
        update();
      }
    });
    $('ucb-url').addEventListener('paste', onUrlPaste);
    $('ucb-messages').addEventListener('click', onMessageAction);
    $('ucb-list').addEventListener('click', onListAction);
    // Write a pending draft before the page goes away (reload right after typing)
    window.addEventListener('pagehide', function () {
      clearTimeout(draftTimer);
      saveDraft();
    });

    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else if (typeof module === 'undefined' || !module.exports) {
    init();
  }

  // Expose global handlers for onclick attributes
  window.ucbCopyUrl           = copyUrl;
  window.ucbCopyParams        = copyParams;
  window.ucbOpenUrl           = openUrl;
  window.ucbAddToList         = addToList;
  window.ucbDownloadPng       = downloadPng;
  window.ucbDownloadSvg       = downloadSvg;
  window.ucbExample           = loadExample;
  window.ucbReset             = resetForm;
  window.ucbPresetSaveStart   = presetSaveStart;
  window.ucbPresetSaveConfirm = presetSaveConfirm;
  window.ucbPresetSaveCancel  = presetSaveCancel;
  window.ucbPresetDelete      = presetDelete;
  window.ucbListCopyAll       = listCopyAll;
  window.ucbListCsv           = listCsv;
  window.ucbListClear         = listClear;

  /* Node test export (no effect in browsers) */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      PARAMS: PARAMS,
      PRESETS: PRESETS,
      CLICK_IDS: CLICK_IDS,
      SOURCE_CATEGORY: SOURCE_CATEGORY,
      codePoints: codePoints,
      wellFormed: wellFormed,
      strictEncode: strictEncode,
      normalizeOptions: normalizeOptions,
      segmentValue: segmentValue,
      normalizeValue: normalizeValue,
      encodeValue: encodeValue,
      encodeUnsafe: encodeUnsafe,
      parseBaseUrl: parseBaseUrl,
      cleanUrl: cleanUrl,
      sourceCategory: sourceCategory,
      predictChannel: predictChannel,
      isKnownMedium: isKnownMedium,
      adviceMessages: adviceMessages,
      buildLink: buildLink,
      csvCell: csvCell,
      buildCsv: buildCsv,
      fileSlug: fileSlug,
      buildSvg: buildSvg,
      toUtf8ByteString: toUtf8ByteString
    };
  }

})();
