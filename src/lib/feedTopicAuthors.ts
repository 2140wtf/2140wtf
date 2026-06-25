/**
 * Curated author pubkey lists for the main feed topic tabs.
 *
 * These voices are sourced from public Nostr relays and filtered to be
 * on-topic for each tab. They are intentionally additive: the topic tabs
 * still support tag-based discovery, but author-filtered tabs give a
 * higher-signal starting point.
 */

/** Core Bitcoin voices — developers, analysts, writers and podcasters. */
export const BITCOIN_TOPIC_AUTHORS: string[] = [
  '19fefd7f39c96d2ff76f87f7627ae79145bc971d8ab23205005939a5a913bc2f', // Stephan Livera
  '04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9', // ODELL
  '84dee6e676e5bb67b4ad4e042cf70cbd8681155db535942fcc6a0533858a7240', // Edward Snowden
  '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2', // jack
  '58c741aa630c2da35a56a77c1d05381908bd10504fdd2d8b43f725efa6d23196', // Alex Gladstein
  '472f440f29ef996e92a186b8d320ff180c855903882e59d50de1b8bd5669301e', // Marty Bent
  '6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93', // Gigi
  '1afe0c74e3d7784eba93a5e3fa554a6eeb01928d12739ae8ba4832786808e36d', // American HODL
  'eab0e756d32b80bcd464f3d844b8040303075a13eabc3599a762c9ac7ab91f4f', // Lyn Alden
  '85080d3bad70ccdcd7f74c29a44f55bb85cbcd3dd0cbb957da1d215bdb931204', // Preston Pysh
  'c48e29f04b482cc01ca1f9ef8c86ef8318c059e0e9353235162f080f26e14c11', // walker
];

/** Nostr protocol builders, client devs and infrastructure voices. */
export const NOSTR_TOPIC_AUTHORS: string[] = [
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d', // fiatjaf
  '32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245', // jb55
  'd61f3bc5b3eb4400efdae6169a5c17cabf3246b514361de939ce4a1a0da6ef4a', // miljan
  '63fe6318dc58583cfe16810f86dd09e18bfd76aabc24a0081ce2856f330504ed', // Kieran
  '460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c', // Vitor Pamplona
  '7fa56f5d6962ab1e3cd424e758c3002b8665f7b0d8dcee9fe9e288d7751ac194', // verbiricha
  'e33fe65f1fde44c6dc17eeb38fdad0fceaf1cae8722084332ed1e32496291d42', // wiz
  '3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24', // Derek Ross
];

/** Macro/economist voices for the Finance tab (includes Fed watchers). */
export const FINANCE_TOPIC_AUTHORS: string[] = [
  '3c989aa8626cfb78be01531a3cedee2f1e810325e00ab43911669d19e5b7a97e', // Arthur Charpentier
  'd7ff1bfc93538b40758dcf98acbced51a8174863832288c1a4f1f452699641ef', // Augie Ray
  '08daf8d274a452b8b231bea147ffcbb2e68a33825288fc0710eafbae08b14037', // Dariia Mykhailyshyna
  'ce01de6677364dfc382c5e8f964b46c414ef51b56de3d3d648bbd46b1b459a18', // Gernot Wagner
  'eb261b29a653893bf21c206c9a8aae7c964c7318edae2841f34bb19272e5926a', // HMACROTRADER
  'e10a312a822127127e421d8862d5b184d9ca31bc941197fefda589acda2da53e', // Luke Gromen
  'd245cb581947fceaffdde99fa51a42d183dcd8f2a1b327c59a13caa7c9c20a6f', // Rich Stein
  'ed35e87e8e9701a99e3c42c5ec0f97f92a166ad91995d19e82c4a412e1139f61', // adeisinta_19
  '05df9984dafedd099112a166a5d6335590bb7e27f28e83b7ff3ab263f09c5b7b', // Bart Hordijk
  '522fa7f2e8267ec89a055952855c8014b49b76ff0d2697703122c97fdfca637c', // RogueMacroCIO
];

/** Developers, security researchers, privacy advocates and AI/tech voices. */
export const TECH_TOPIC_AUTHORS: string[] = [
  'ffe7c93d40b8d5fe5f70cb8eb1c225e23d50b50390d72ee900a7338bc9f02363', // Sicurezza Digitale
  'ab523a5084625cffe5bce0fd9af53e4ced9ca1ced6553d57fd35acd24eb0e246', // Aaron Toponce
  'f4cd659fcfa7c5ed3cb28e3ecd3479420fd6b367f3dfad0d5a6b3b4dbcbcdbb0', // Adam
  'e80e6896d6a35324e54c6edcfc795579aece4b29675a499566803d26742a431b', // ahf
  '9da994565b2f3100ad1714080d081a90c771b9bb1276d939795f5a9e179af829', // Aral Balkan
  '8b517f8e700707dfd4d8e974f56d183711978d72303063030a36049193ea7459', // Brian Fagioli
  '87d90b24170d8ae4ceac5e56f415b770e8f34c53dd7518ab01f417646c9c7547', // Cat (D.Burch)
  '5813cb0c08b954765976fe9867ea38b2b1524e39b1f75ab22b326e25833aa766', // Catalin Cimpanu
  'a6c37c8f2c173283b15f869f9154d6a5482a971c331584ab0aa282570e7f7116', // Christina Warren
  '657d6ebf3b54bc282e0f6c38fdbec4816896acb71335db6cd55fc506a13982e4', // da_667
  '8221dfffd0a469aa3c9c63e427c50200fcfa173bd226a6678da185d47a06363f', // Dan Ports
  'ed98dd172c8fec81e65ac4d2b0687fe3ac855a12e939c028820df32002c896e7', // David Chisnall
  '3ba6f93621f4f5c893dbc57417dc268e36b616d1df0ea1e1ffbd9111b489a15f', // evacide
  '9c9f81ed795f0f5efa558932824687d84fc7e6a4cfa6db5d6d3b50fcb7ffaec2', // Frederik Handberg
  '475d8652e1f6937aa10c91286f439768b47672fac5f2fd12f114ed434df115cc', // Gary McGraw
  '3c65f4528f1db02ae90cd1ce3c494daf425c18dc5d3e854fb9bf73a55fe3fcd3', // HD Moore
  'd5bf122d57bdad3b5e5112d094b3ead95f403eb5fc2feb1dbf0c50414eac357a', // Jeff Moss
  'f6870afcde4480ec8508f50304859e14a51309ff24ab3f0f862c52bdc4af8747', // Kevin Beaumont
  'a516f2358a20a90c560bed25b34fb39ee5bd12a7187837df8c96a19e0070ce6d', // Ian Campbell
  'a439c6ec6a2b1a3301b2d220ad81e057f248a5351f043a9f42165d8c3b3a7143', // Isaac Levin
  'a69cac96fd8b825a67e39aa0aa526220f64b5fff88d3e49d7cfa45d54d3ea842', // Jerry
  '33c7473a3cae064d495444ff2ef1e4700cf3e3dd0dc276c718c06b2c175da9b2', // knoppix
  '4a1961c0202b44430b3824c2a053557bb0e6a073d06b8a5b3c728d5112418ce0', // Kyle Brown
  'c72a3d0565a87f8b46ac5b8ab88a45f56cf67de2398a8cba8c6855cb3a39b0ea', // LisPi
  'a1fd3539b9dc914130a76480b17537553a6cdfa3968e8d69bedcc790cbf08084', // Mäh W.
];

/** International journalists, correspondents and geopolitics voices. */
export const WORLD_TOPIC_AUTHORS: string[] = [
  '6561f3864d9569f2b96ffa7afaf99ccb1c517c3bc2e900725939b2bb5289d828', // Andy Ngo
  '1a5ac5b37984c5e37a11bc914029a81f025326ea7950c9475d9a3f21a494cb56', // Brian Krebs
  'dd109f7af73022def97e7ea775a91abd3baff382d7c082bce10a594d56193cf3', // Mariya Petkova
  '20012156e439af544cdf055909daef026040273050600eaeb6698dba5026e2b6', // Juan Cole
  'd3ef13f593b0db26510ce34414344d1cd893b0d7a78dae05e099d57d15abaaea', // stefania maurizi
  'd72daf5d440b44951c06cab9b20a4f4c10d1627dfa4e2cb1cc890db034cca757', // Richard Medhurst
  '3b1911bfd4c79b2598bc66a2c7eacda78323e7c7eba6fd477788908930ec3cd5', // Qasim Rashid
  '9ce5b37f4458ebfc42083b61bd63e23f7e679422a8e67bb4aa227e8585bcd34f', // Sam Litzinger
  '2a3be70be0dd04fa30653ba5a984acb7aef90fdf75da220509138678392b919d', // Δρομογράφος
  'ddc6c81c03da216550654f73121985d8f30636aac98903de01993746bab7bdb3', // Erik Jonker
];

/** Political journalists, pundits and policy commentators across the spectrum. */
export const POLITICS_TOPIC_AUTHORS: string[] = [
  '27466fc0f8fc5f1d627c9be7448477329615dc0a57f584fde2fa9bf06e1ca390', // Airstrip One News
  '5af2ec30b0b35679da9f4c3ab85604e48494fb8c379dfa00ce28b44c87c20d83', // br00t4c
  'c72aa0b3e67c3d9c888455083cc09b73ee06cdf7719c0f8bdecf234f8a658e6f', // Fiorella Isabel
  '5aa46cd8e5bdaec801e66be983c6846aaefbdc5c6eeedd373ad1ea29c40d57dd', // nataliewinters
  '2a7cfb9ae869caa3be49a33d87bd4a0f5343af0fdea880e2a6655a3a9f86a232', // Nicholas Sarwark
  'b5a661ac1dfe55fdd2999989779d9dea534bda3dd5d04d5b295602bd34e313be', // Randahl Fink
  'afb338208adf4f976284bb2992b1251d521a02db5d10b96ec942df88d9c18341', // Lukasz Olejnik
  '2e15374146fbdcbb7b102175845d024c4980cf2bfab5c26abe5abe361d48b8fb', // Scott Ryan Presler
  '5e759c2ca4a4e222ba7af89e6ff315e1d27843fe8bd0a3e7e61e4ba5b1c07326', // Josephus
  '9f78e0c42bee3722685d715f58a2a5df5c19d97886f9b322273a992687956cb8', // Jules
  '901f6516fd35841951050c58481db24f9dcc631e3d1f4332bbfa172db9c6696a', // Kim Perales
  '640a2f6ed75a0afee63752d83bde1a936a4f03ba4c06d905cfac6c7e52009318', // lib
  'd5d9a7f4a8af150c37dacae82c62fef01de622dd1721f09d5a0133e777f021c2', // HunDriverWidow
  '74389510c5c33b65f5760cf44c74d77d572f9c8d8e10f33a225f40f1cb1ea7a6', // NHPilled
  '6bf98545cf43a42d6b3b4aa27284df3de64acc444cf32e218b78b1276766c186', // Lino
  'd759f86489398d77ba85d7887434f559ff495910da078b1b0c034f406085f829', // LittleAlex
  '92999c921b2d6d9fac188b3ec160ec3a0959fbce5c61069846e04ff92988ae93', // loStronzoRocco
  '9d9014739d0e58bc09f00f71fc2b7af9425fd6ec69834b6b72c95a85d825cfe2', // Ripper Magoo
  '1103964f9e9c90dfa4da300ebbc32e009233211cf0ee15767953204dfbed6924', // azorcode
  '510bb2876fb28f1127608bdad60d458c3d164df50c153613cb7736816fcfc069', // Carnouse
];

/** Sports-specific accounts on Nostr. The ecosystem is thin here. */
export const SPORTS_TOPIC_AUTHORS: string[] = [
  'bd32408642b595f051309efa44d77fa330afa9547f1ed275cdad2a493af6904c', // Chuck Berray
  '2cf131819497c71793381ec4a01d96e891fbe919d98e086f0df1ef7a05b05cc9', // Chuck Darwin
  '9dc5c231539fc01d3bb9a45edd386b96e5b5e8768dc2cb8ce3cfcc331fe844ac', // Deborah Edwards-Oñoro
  '7dcdb38bb428696c4fd96208828974c5e9a1a8a6a51b4aa9102df01e9c7abec7', // Formula Bone
  '252f40dd90acb77266812a311aa3646c4ae03519e45002f80603a8d58129d283', // Jena
  '0ed7235a879b4dfff3614d3e1d9025bee24bdeabb8275dcef1a8edcc4de63d1d', // neatchee
  '4ec73fe8b1d392447b5749366b64c6baf6d43c5bec5e87bdeb873fa96bffe2fe', // Hardwood Handicappers
];
