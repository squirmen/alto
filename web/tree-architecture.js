/* ALTO botanical form templates, version 3.
 *
 * Original procedural geometry; nothing is borrowed from scan libraries. A template is a
 * hypothesis about growth habit, chosen from the recorded name, a field identification or a
 * growth-form guess. The record's own dimensions set the scale; the template supplies a
 * branching framework and foliage in that habit. No branch, leaf or root position is
 * surveyed, and the assumptions list says so on every model.
 *
 * What changed in v3: forty-odd habits instead of eleven, a real branching skeleton (three
 * orders, each order reaching for the crown envelope of its habit), smooth-shaded foliage
 * instead of faceted lumps, species colouring, multi-stem trunks from field evidence, and a
 * foliage switch so the framework can be seen on its own.
 */
(function(root){
  'use strict';
  const normal=s=>String(s??'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
  const usable=s=>s&&!/^(unknown|unidentified|unspecified|not identified|species not recorded|0 records found\.|none|null|mixed|other|tree|trees|native trees|n\/a)(\b|$)/.test(s);
  const nz='https://www.nzpcn.org.nz/flora/species/';
  const refs={pohutukawa:nz+'metrosideros-excelsa/',kauri:nz+'agathis-australis/',nikau:nz+'rhopalostylis-sapida/',cabbage:nz+'cordyline-australis/',totara:nz+'podocarpus-totara/',rimu:nz+'dacrydium-cupressinum/',kahikatea:nz+'dacrycarpus-dacrydioides/',puriri:nz+'vitex-lucens/',kowhai:nz+'sophora-microphylla/',manuka:nz+'leptospermum-scoparium/',rewarewa:nz+'knightia-excelsa/'};

  // Colours are linear-ish RGB in 0..1. `foliage` is the leaf mass, `bark` the stem.
  const GREEN={dark:[.20,.33,.21],deep:[.17,.31,.20],mid:[.30,.47,.27],fresh:[.38,.56,.29],light:[.46,.61,.33],olive:[.36,.46,.25],grey:[.44,.53,.42],glossy:[.22,.40,.24],blue:[.31,.45,.36],yellowgreen:[.47,.58,.28]};
  const BARK={brown:[.43,.34,.25],grey:[.50,.47,.42],pale:[.66,.62,.54],white:[.82,.80,.74],dark:[.34,.28,.22],fibrous:[.46,.38,.29],red:[.47,.30,.22],mottled:[.62,.59,.49]};

  // habit: how the framework is built. envelope: the crown outline the branches reach for.
  // base: crown base as a fraction of height when the record has no live-crown height.
  // trunk: where the first fork sits (fraction of height) for decurrent habits.
  // limbs/sub/twigs: branch counts by order. cluster: foliage cluster radius relative to
  // crown radius. clusters: budget of foliage clusters. shape: xyz aspect of a cluster.
  const catalogue={
    pohutukawa:{label:'Pōhutukawa',source:refs.pohutukawa,rootForm:'branching',habit:'decurrent',envelope:'dome',base:.22,trunk:.16,stems:3,limbs:8,sub:3,twigs:2,angle:62,arch:-.04,spread:.92,cluster:.17,clusters:110,shape:[1,.7,1],foliage:GREEN.dark,bark:[.40,.38,.33],mottle:.15,description:'Low forks, arching limbs that can rest on the ground, and a broad, irregular evergreen crown.'},
    rata:{label:'Rātā',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.4,trunk:.36,limbs:7,sub:3,twigs:2,angle:50,arch:.06,spread:.9,cluster:.17,clusters:100,shape:[1,.75,1],foliage:GREEN.dark,bark:[.42,.38,.32],description:'A taller trunk than pōhutukawa with a broad, dense evergreen crown.'},
    kauri:{label:'Kauri',source:refs.kauri,rootForm:'branching',habit:'decurrent',envelope:'irregular',base:.55,trunk:.52,limbs:7,sub:3,twigs:2,angle:48,arch:.12,spread:.85,limbT:[.2,.75],cluster:.23,clusters:70,shape:[1,.8,1],foliage:GREEN.olive,bark:BARK.grey,mottle:.2,description:'A straight, clean bole with heavy ascending limbs and an irregular upper crown.'},
    totara:{label:'Tōtara',source:refs.totara,rootForm:'branching',habit:'decurrent',envelope:'oval',base:.28,trunk:.3,limbs:8,sub:3,twigs:2,angle:55,arch:.05,spread:.9,cluster:.15,clusters:120,shape:[1,.8,1],foliage:[.32,.42,.25],bark:BARK.fibrous,mottle:.25,description:'A stout trunk with stringy bark and a dense, rounded, dark olive crown.'},
    rimu:{label:'Rimu',source:refs.rimu,rootForm:'branching',habit:'excurrent',envelope:'cone',base:.3,whorls:11,perWhorl:5,droop:-.35,cluster:.12,clusters:120,shape:[.6,1.3,.6],foliage:[.30,.42,.24],bark:BARK.dark,description:'A conical crown of pendulous, weeping branchlets on a straight trunk.'},
    kahikatea:{label:'Kahikatea',source:refs.kahikatea,rootForm:'branching',habit:'excurrent',envelope:'column',base:.5,whorls:10,perWhorl:5,droop:.05,cluster:.14,clusters:90,shape:[1,.7,1],foliage:GREEN.olive,bark:BARK.grey,description:'A tall, narrow tree with a small crown held high on a clean trunk.'},
    puriri:{label:'Pūriri',source:refs.puriri,rootForm:'branching',habit:'decurrent',envelope:'dome',base:.25,trunk:.22,limbs:7,sub:3,twigs:2,angle:60,arch:.04,spread:.9,cluster:.18,clusters:110,shape:[1,.75,1],foliage:GREEN.glossy,bark:BARK.pale,mottle:.2,description:'A short, thick trunk and a wide, dense, glossy evergreen dome.'},
    native_broadleaf:{label:'Native broadleaf',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:50,arch:.06,spread:.9,cluster:.16,clusters:110,shape:[1,.8,1],foliage:GREEN.glossy,bark:BARK.grey,description:'A rounded, dense evergreen crown on a single trunk; tītoki, karaka, taraire, kohekohe and their kin.'},
    kowhai:{label:'Kōwhai',source:refs.kowhai,rootForm:'branching',habit:'decurrent',envelope:'oval',base:.3,trunk:.3,limbs:6,sub:3,twigs:2,angle:50,arch:.02,spread:.9,cluster:.12,clusters:110,shape:[1,.8,1],foliage:GREEN.light,bark:BARK.brown,description:'A small, open tree with fine foliage and a light, rounded crown.'},
    manuka:{label:'Mānuka / kānuka',source:refs.manuka,rootForm:'branching',habit:'decurrent',envelope:'oval',base:.35,trunk:.4,limbs:6,sub:3,twigs:3,angle:35,arch:.08,spread:.85,cluster:.10,clusters:130,shape:[.8,1.1,.8],foliage:GREEN.grey,bark:BARK.fibrous,mottle:.3,description:'Slender stems and a fine-textured, upright crown of very small leaves.'},
    rewarewa:{label:'Rewarewa',source:refs.rewarewa,rootForm:'branching',habit:'decurrent',envelope:'column',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:30,arch:.12,spread:.9,cluster:.13,clusters:100,shape:[.8,1.1,.8],foliage:GREEN.dark,bark:BARK.grey,description:'A tall, narrow, columnar crown of upright branches.'},
    nikau:{label:'Nīkau',source:refs.nikau,rootForm:'fibrous',habit:'palm_feather',fronds:13,rise:.28,droop:.6,crownshaft:true,cluster:.1,foliage:[.27,.46,.24],bark:[.52,.50,.42],description:'An unbranched, ringed stem, a green crownshaft and upright feather fronds.'},
    phoenix:{label:'Phoenix palm',rootForm:'fibrous',habit:'palm_feather',fronds:34,rise:.22,droop:1.1,thick:1.25,cluster:.1,foliage:[.30,.48,.24],bark:BARK.fibrous,mottle:.3,description:'A massive, patterned trunk and a dense, rounded head of long arching fronds.'},
    feather_palm:{label:'Feather palm',rootForm:'fibrous',habit:'palm_feather',fronds:18,rise:.25,droop:.9,cluster:.1,foliage:[.30,.48,.26],bark:BARK.grey,description:'A single stem with arching pinnate fronds.'},
    fan_palm:{label:'Fan palm',rootForm:'fibrous',habit:'palm_fan',fronds:22,rise:.2,droop:.5,cluster:.1,foliage:[.33,.49,.27],bark:BARK.fibrous,description:'A single, often tall stem with segmented fan-shaped fronds.'},
    cabbage:{label:'Tī kōuka / cabbage tree',source:refs.cabbage,rootForm:'branching',habit:'tufted',heads:6,cluster:.1,foliage:[.42,.55,.32],bark:BARK.grey,mottle:.2,description:'Forking stems, each ending in a dense head of long strap-like leaves.'},
    tree_fern:{label:'Ponga / tree fern',rootForm:'fibrous',habit:'fern',fronds:12,rise:.3,droop:.7,cluster:.1,foliage:GREEN.fresh,bark:[.35,.27,.20],description:'A fibrous trunk with a wide, spreading crown of finely divided fronds.'},
    norfolk:{label:'Norfolk Island pine',rootForm:'branching',habit:'excurrent',envelope:'cone',base:.1,whorls:14,perWhorl:5,droop:.02,tiered:true,cluster:.11,clusters:150,shape:[1.2,.35,1.2],foliage:GREEN.deep,bark:BARK.dark,description:'A symmetrical, tiered cone: regular whorls of near-horizontal branches on a straight trunk.'},
    pine:{label:'Pine',rootForm:'branching',habit:'umbrella',envelope:'umbrella',base:.55,trunk:.58,limbs:5,sub:3,twigs:2,angle:45,arch:.14,spread:.9,limbT:[.3,.8],cluster:.22,clusters:60,shape:[1.25,.45,1.25],foliage:[.24,.38,.24],bark:BARK.red,mottle:.35,description:'A tall, bare trunk and an irregular, flat-topped crown of dense needle tufts.'},
    macrocarpa:{label:'Macrocarpa',rootForm:'branching',habit:'decurrent',envelope:'flat',base:.2,trunk:.18,stems:2,limbs:8,sub:3,twigs:2,angle:65,arch:.06,spread:.95,cluster:.17,clusters:120,shape:[1,.55,1],foliage:[.27,.43,.24],bark:BARK.fibrous,mottle:.2,description:'Heavy spreading limbs from low on the trunk and a broad, flattened crown.'},
    cypress:{label:'Cypress',rootForm:'branching',habit:'excurrent',envelope:'cone',base:.06,whorls:16,perWhorl:6,droop:.04,cluster:.12,clusters:170,shape:[1,.7,1],foliage:[.26,.42,.25],bark:BARK.fibrous,description:'A dense, narrow cone of fine sprays reaching almost to the ground.'},
    column_conifer:{label:'Columnar cypress',rootForm:'branching',habit:'excurrent',envelope:'column',base:.05,whorls:18,perWhorl:6,droop:.2,cluster:.13,clusters:150,shape:[.9,1.1,.9],foliage:GREEN.deep,bark:BARK.fibrous,description:'A tight, pencil-shaped column of upswept branches.'},
    cedar:{label:'Cedar',rootForm:'branching',habit:'excurrent',envelope:'cone',base:.15,whorls:10,perWhorl:6,droop:-.12,tiered:true,cluster:.14,clusters:140,shape:[1.3,.4,1.3],foliage:GREEN.blue,bark:BARK.grey,description:'Broad, layered horizontal branches with slightly drooping tips on a conical outline.'},
    redwood:{label:'Redwood / swamp cypress',rootForm:'branching',habit:'excurrent',envelope:'cone',base:.2,whorls:14,perWhorl:6,droop:-.06,cluster:.11,clusters:150,shape:[1.1,.5,1.1],foliage:[.29,.44,.26],bark:BARK.red,mottle:.2,description:'A tall, straight cone with short, level branches and a clean lower trunk.'},
    conifer:{label:'Conifer',rootForm:'branching',habit:'excurrent',envelope:'cone',base:.15,whorls:11,perWhorl:6,droop:-.08,cluster:.13,clusters:130,shape:[1.1,.55,1.1],foliage:[.20,.35,.26],bark:BARK.dark,description:'A central leader with layered evergreen branch sprays.'},
    eucalyptus:{label:'Eucalyptus',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.45,trunk:.42,limbs:5,sub:3,twigs:2,angle:38,arch:.1,spread:.85,limbT:[.2,.75],cluster:.13,clusters:70,shape:[.75,1.2,.75],foliage:GREEN.grey,bark:[.74,.71,.63],mottle:.45,description:'A tall, smooth pale trunk and an open, loose crown of hanging leaf clusters.'},
    plane:{label:'Plane',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.35,trunk:.33,limbs:7,sub:3,twigs:2,angle:48,arch:.1,spread:.9,cluster:.16,clusters:120,shape:[1,.8,1],foliage:GREEN.fresh,bark:BARK.mottled,mottle:.6,deciduous:true,description:'A tall, broad deciduous dome on a mottled, flaking trunk.'},
    oak:{label:'Oak',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.3,trunk:.28,limbs:8,sub:3,twigs:2,angle:58,arch:.06,spread:.92,cluster:.16,clusters:130,shape:[1,.8,1],foliage:GREEN.mid,bark:BARK.grey,mottle:.2,deciduous:true,description:'Heavy, crooked limbs and a broad, rounded deciduous crown.'},
    holm_oak:{label:'Holm oak',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.28,trunk:.26,limbs:8,sub:3,twigs:2,angle:56,arch:.05,spread:.9,cluster:.15,clusters:140,shape:[1,.8,1],foliage:GREEN.dark,bark:BARK.dark,description:'A dense, dark, rounded evergreen dome on stout limbs.'},
    fig:{label:'Moreton Bay fig',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.2,trunk:.18,stems:2,limbs:9,sub:3,twigs:2,angle:70,arch:-.02,spread:.95,cluster:.17,clusters:140,shape:[1,.7,1],foliage:GREEN.glossy,bark:BARK.grey,buttress:1.6,description:'A buttressed trunk and enormous spreading limbs under a wide, dense crown.'},
    magnolia:{label:'Evergreen magnolia',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.15,trunk:.2,limbs:8,sub:3,twigs:2,angle:45,arch:.05,spread:.9,cluster:.14,clusters:140,shape:[1,.85,1],foliage:GREEN.glossy,bark:BARK.grey,description:'A dense, conical-to-oval crown of large glossy leaves, branched almost to the ground.'},
    liquidambar:{label:'Liquidambar / tulip tree',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.22,trunk:.28,limbs:8,sub:3,twigs:2,angle:42,arch:.08,spread:.85,cluster:.14,clusters:130,shape:[1,.85,1],foliage:GREEN.fresh,bark:BARK.grey,deciduous:true,description:'A tall, upright, oval to pyramidal deciduous crown on a straight trunk.'},
    elm:{label:'Elm',rootForm:'branching',habit:'decurrent',envelope:'vase',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:35,arch:.1,spread:.92,cluster:.15,clusters:120,shape:[1,.8,1],foliage:GREEN.mid,bark:BARK.grey,deciduous:true,description:'Ascending limbs that fan out into a vase-shaped deciduous crown.'},
    jacaranda:{label:'Jacaranda',rootForm:'branching',habit:'decurrent',envelope:'vase',base:.35,trunk:.35,limbs:6,sub:3,twigs:2,angle:42,arch:.1,spread:.9,cluster:.13,clusters:90,shape:[1.1,.6,1.1],foliage:GREEN.light,bark:BARK.grey,deciduous:true,description:'An open, spreading vase of fine, feathery foliage.'},
    silk_tree:{label:'Silk tree / wattle',rootForm:'branching',habit:'umbrella',envelope:'flat',base:.35,trunk:.35,limbs:6,sub:3,twigs:2,angle:60,arch:.04,spread:.95,cluster:.14,clusters:90,shape:[1.2,.45,1.2],foliage:GREEN.light,bark:BARK.grey,description:'A low, wide, flat-topped crown of fine foliage on spreading limbs.'},
    melia:{label:'Bead tree',rootForm:'branching',habit:'umbrella',envelope:'umbrella',base:.4,trunk:.4,limbs:6,sub:3,twigs:2,angle:55,arch:.06,spread:.92,cluster:.15,clusters:90,shape:[1.1,.6,1.1],foliage:GREEN.fresh,bark:BARK.brown,deciduous:true,description:'A spreading, umbrella-shaped deciduous crown on a short trunk.'},
    birch:{label:'Birch',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.3,trunk:.35,limbs:7,sub:3,twigs:3,angle:32,arch:-.05,spread:.85,cluster:.11,clusters:120,shape:[.8,1.1,.8],foliage:GREEN.light,bark:BARK.white,mottle:.4,deciduous:true,description:'A light, open oval crown with drooping twigs on a pale trunk.'},
    poplar:{label:'Poplar',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.25,trunk:.35,limbs:8,sub:3,twigs:2,angle:32,arch:.1,spread:.85,cluster:.13,clusters:130,shape:[.9,1,.9],foliage:GREEN.mid,bark:BARK.pale,mottle:.2,deciduous:true,description:'A tall, upright oval crown of ascending branches.'},
    column:{label:'Columnar',rootForm:'branching',habit:'decurrent',envelope:'column',base:.12,trunk:.2,limbs:9,sub:3,twigs:2,angle:15,arch:.1,spread:.9,cluster:.12,clusters:130,shape:[.8,1.2,.8],foliage:GREEN.mid,bark:BARK.grey,deciduous:true,description:'Strongly upswept branches held close to the trunk in a narrow column.'},
    willow:{label:'Weeping willow',rootForm:'branching',habit:'weeping',envelope:'weeping',base:.25,trunk:.28,limbs:7,sub:3,twigs:2,angle:50,arch:.12,spread:.85,pendant:.7,cluster:.1,clusters:90,shape:[.5,1.2,.5],foliage:GREEN.yellowgreen,bark:BARK.brown,deciduous:true,description:'Arching limbs and long, hanging curtains of foliage.'},
    weeping_evergreen:{label:'Weeping evergreen',rootForm:'branching',habit:'weeping',envelope:'weeping',base:.25,trunk:.28,limbs:7,sub:3,twigs:2,angle:50,arch:.06,spread:.85,pendant:.45,cluster:.1,clusters:70,shape:[.6,1.1,.6],foliage:GREEN.grey,bark:BARK.fibrous,description:'A rounded evergreen crown with pendulous outer branches; willow myrtle, pepper tree and similar.'},
    bottlebrush:{label:'Bottlebrush / tea tree',rootForm:'branching',habit:'weeping',envelope:'oval',base:.25,trunk:.28,limbs:6,sub:3,twigs:2,angle:48,arch:.04,spread:.88,pendant:.25,cluster:.1,clusters:90,shape:[.7,1,.7],foliage:GREEN.grey,bark:BARK.fibrous,mottle:.2,description:'A small, rounded evergreen crown with drooping branch tips.'},
    cherry:{label:'Cherry / blossom tree',rootForm:'branching',habit:'decurrent',envelope:'vase',base:.28,trunk:.3,limbs:6,sub:3,twigs:2,angle:48,arch:.05,spread:.92,cluster:.14,clusters:100,shape:[1,.75,1],foliage:GREEN.fresh,bark:BARK.red,mottle:.2,deciduous:true,description:'A small, spreading deciduous tree with a wide, open crown.'},
    small_deciduous:{label:'Small deciduous tree',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.25,trunk:.25,limbs:6,sub:3,twigs:2,angle:55,arch:.05,spread:.9,cluster:.14,clusters:100,shape:[1,.7,1],foliage:GREEN.fresh,bark:BARK.grey,deciduous:true,description:'A small, layered, rounded deciduous crown.'},
    small_evergreen:{label:'Small evergreen tree',rootForm:'branching',habit:'decurrent',envelope:'oval',base:.15,trunk:.2,limbs:7,sub:3,twigs:2,angle:45,arch:.05,spread:.9,cluster:.13,clusters:130,shape:[1,.85,1],foliage:GREEN.glossy,bark:BARK.grey,description:'A dense, oval evergreen crown branched close to the ground.'},
    olive:{label:'Olive',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.25,trunk:.25,stems:2,limbs:7,sub:3,twigs:2,angle:55,arch:.04,spread:.9,cluster:.13,clusters:120,shape:[1,.8,1],foliage:[.50,.55,.42],bark:BARK.grey,mottle:.3,description:'A gnarled, often multi-stemmed trunk and a rounded grey-green crown.'},
    maple:{label:'Maple / ash',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:50,arch:.08,spread:.9,cluster:.15,clusters:120,shape:[1,.8,1],foliage:GREEN.mid,bark:BARK.grey,deciduous:true,description:'A rounded deciduous crown on a single trunk.'},
    deciduous:{label:'Deciduous broadleaf',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:52,arch:.06,spread:.9,cluster:.15,clusters:120,shape:[1,.8,1],foliage:GREEN.mid,bark:BARK.grey,deciduous:true,description:'A branching framework and a rounded, leaf-on crown; the season is assumed.'},
    broadleaf:{label:'Evergreen broadleaf',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:52,arch:.06,spread:.9,cluster:.16,clusters:120,shape:[1,.8,1],foliage:GREEN.glossy,bark:BARK.grey,description:'A branching trunk and an irregular, leafy evergreen crown.'},
    unknown:{label:'Generic tree',rootForm:'branching',habit:'decurrent',envelope:'dome',base:.3,trunk:.3,limbs:7,sub:3,twigs:2,angle:52,arch:.06,spread:.9,cluster:.16,clusters:120,shape:[1,.8,1],foliage:GREEN.mid,bark:BARK.brown,description:'A general broadleaf-shaped placeholder until the tree type is identified.'}
  };

  // Ordered: the first match wins, so specific species precede their genus and genera
  // precede common names. Names are normalised (lower case, macrons stripped).
  const SPECIES=[
    [/^metrosideros (excelsa|kermadecensis)|^metrosideros sp|^pohutukawa/,'pohutukawa'],
    [/^metrosideros (robusta|umbellata|bartlettii)|\brata\b/,'rata'],
    [/^metrosideros/,'pohutukawa'],
    [/^agathis|^kauri/,'kauri'],
    [/^podocarpus totara|^totara/,'totara'],
    [/^podocarpus|^prumnopitys|^afrocarpus|\bmiro\b|\bmatai\b/,'totara'],
    [/^dacrydium|^rimu/,'rimu'],
    [/^dacrycarpus|^kahikatea/,'kahikatea'],
    [/^phyllocladus|^libocedrus|tanekaha|kawaka/,'cypress'],
    [/^vitex|^puriri/,'puriri'],
    [/^knightia|rewarewa/,'rewarewa'],
    [/^sophora|kowhai/,'kowhai'],
    [/^leptospermum|^kunzea|manuka|kanuka|tea tree/,'manuka'],
    [/^alectryon|^corynocarpus|^beilschmiedia|^dysoxylum|^meryta|^nestegis|^elaeocarpus|^litsea|^griselinia|^pittosporum|^myrsine|^melicytus|^hoheria|^plagianthus|^carpodetus|^coprosma|^myoporum|^pseudopanax|^schefflera|^dodonaea|^corokia|^hebe|^veronica|titoki|karaka|taraire|tawa|kohekohe|\bpuka\b|maire|hinau|mahoe|houhere|lacebark|taupata|ngaio|five finger|lancewood|akeake|koromiko|lemonwood|tarata|matipo|karo|kapuka|broadleaf$/,'native_broadleaf'],
    [/^rhopalostylis|nikau/,'nikau'],
    [/^phoenix|phoenix palm|canary island date/,'phoenix'],
    [/^washingtonia|^trachycarpus|^livistona|^sabal|^chamaerops|^brahea|fan palm|cotton palm|windmill palm|california palm|nikau palm$/,'fan_palm'],
    [/^syagrus|^archontophoenix|^butia|^howea|^cocos|^jubaea|^arecastrum|^dypsis|^chamaedorea|^cogus|^unknown palm|queen pa|bangalow|kentia|\bpalm\b/,'feather_palm'],
    [/^cordyline|^dracaena|^yucca|cabbage tree|ti kouka|dragon tree/,'cabbage'],
    [/^(cyathea|alsophila|sphaeropteris|dicksonia)|punga|ponga|tree fern|silver fern|wheki|mamaku/,'tree_fern'],
    [/^lagunaria|norfolk island hibiscus/,'magnolia'],
    [/^araucaria heterophylla|^araucaria (columnaris|excelsa)|norfolk/,'norfolk'],
    [/^araucaria|bunya|^agathis robusta/,'cedar'],
    [/^pinus|\bpine$|maritime pine|radiata/,'pine'],
    [/^cupressus macrocarpa|macrocarpa/,'macrocarpa'],
    [/^populus nigra .?italica|lombardy|^liriodendron tulipifera .?fastigiat|^quercus robur .?fastigiat|^carpinus betulus .?fastigiat/,'column'],
    [/^cupressus sempervirens|italian cypress|fastigiat|^juniperus (communis|scopulorum|virginiana)|pencil/,'column_conifer'],
    [/^cupressus|^chamaecyparis|^cupressocyparis|^x ?cupressocyparis|^thuja|^cryptomeria|^juniperus|^callitris|^platycladus|cypress|leyland|arbor-?vitae/,'cypress'],
    [/^cedrus|cedar/,'cedar'],
    [/^sequoia|^sequoiadendron|^metasequoia|^taxodium|redwood|wellingtonia|swamp cypress|dawn redwood/,'redwood'],
    [/^picea|^abies|^pseudotsuga|^tsuga|^larix|^taxus|spruce|\bfir\b|douglas|larch|\byew\b/,'conifer'],
    [/^casuarina|^allocasuarina|she ?oak/,'weeping_evergreen'],
    [/^eucalyptus|^corymbia|^angophora|\bgum\b|eucalypt/,'eucalyptus'],
    [/^platanus|plane/,'plane'],
    [/^quercus ilex|holm oak/,'holm_oak'],
    [/^quercus|\boak\b|^fagus|beech|^aesculus|chestnut|^celtis|nettle tree|^castanea|^juglans|walnut|^carya|pecan/,'oak'],
    [/^ficus|\bfig\b/,'fig'],
    [/^magnolia grandiflora|^magnolia (virginiana|delavayi)|^michelia|^magnolia doltsopa|^lagunaria|^stenocarpus|^ilex|holly|^hymenosporum|^brachychiton|flame tree|^grevillea robusta|silky oak/,'magnolia'],
    [/^ulmus|^zelkova|\belm\b/,'elm'],
    [/^liquidambar|^liriodendron|^tilia|^nyssa|^ginkgo|^pyrus calleryana|^pyrus|tulip tree|\blime\b|linden|tupelo|maidenhair|callery|\bpear\b/,'liquidambar'],
    [/^jacaranda|^gleditsia|^robinia|^ailanthus|^koelreuteria|^tipuana|^sapium|^triadica|honey locust|black locust|tree of heaven|golden rain/,'jacaranda'],
    [/^albizzia|^albizia|^racosperma|^acacia|^paraserianthes|silk tree|wattle|blackwood/,'silk_tree'],
    [/^melia|bead tree|chinaberry|^erythrina|coral tree|^paulownia|^catalpa|^delonix|^bauhinia|^ceiba|^chorisia/,'melia'],
    [/^betula|birch|^alnus|alder/,'birch'],
    [/^populus|poplar|cottonwood|aspen/,'poplar'],
    [/^salix (babylonica|x sepulcralis|alba .?tristis)|weeping willow|^salix|willow/,'willow'],
    [/^agonis|^schinus|pepper tree|willow myrtle|juniper myrtle|weeping/,'weeping_evergreen'],
    [/^callistemon|^melaleuca|bottle ?brush|paperbark/,'bottlebrush'],
    [/^prunus|^malus|cherry|plum|apple|blossom|^crataegus|hawthorn|^cercis|redbud|^lagerstroemia|crepe|^magnolia|^amelanchier|^cydonia|quince/,'cherry'],
    [/^acer palmatum|japanese maple|^cotinus|^cornus|dogwood|^parrotia|^styrax|^halesia|^koelreuteria/,'small_deciduous'],
    [/^acer|maple|sycamore|box elder|^fraxinus|\bash\b|^sorbus|rowan|^idesia|wonder tree/,'maple'],
    [/^olea|olive/,'olive'],
    [/^camellia|^photinia|^ligustrum|privet|^euonymus|spindle|^cotoneaster|^rhododendron|^viburnum|^laurus|bay laurel|^prunus laurocerasus|^pittosporum|^syzygium|^acmena|lilly ?pilly|^feijoa|^acca|^citrus|lemon|orange|mandarin|^persea|avocado|^eriobotrya|loquat|^macadamia|^nerium|oleander|^hibiscus|^abelia|^banksia|^leucadendron|^protea|^strebulus|^streblus|^psidium|guava|^diospyros|persimmon|^morus|mulberry|^michelia figo|^osmanthus|^arbutus|strawberry tree|^cinnamomum|camphor|^lophostemon|^tristaniopsis|^tristania|water gum|brush box|^harpephyllum|^elaeagnus|^pseudowintera|^weinmannia|^quillaja|^ceratonia|carob/,'small_evergreen'],
    [/^cinnamomum|camphor|^lophostemon|^tristaniopsis|^harpephyllum|kaffir plum/,'broadleaf'],
  ];
  // Large evergreens in the small list above that deserve a full dome: camphor, brush box,
  // water gum. The second entry never wins because the first does; order them here.
  SPECIES.splice(SPECIES.findIndex(x=>x[1]==='small_evergreen'),0,[/^cinnamomum|camphor|^lophostemon|brush box|^tristaniopsis laurina|water gum|^harpephyllum/,'broadleaf']);

  function match(name){for(const [re,id] of SPECIES)if(re.test(name))return id;return null;}

  function identify(record,override,live){
    const d=record.datasets||{},r=d.record||{},observed=d.ground||{},field=live?.species||null;
    const latin=normal(field?.latin||observed.species_latin||r.species_latin||r.species_latin_raw),common=normal(field?.common||observed.species_common||r.species_common||r.species_common_raw);
    const hasLatin=usable(latin),hasCommon=usable(common);
    let id=null,basis=field?'photo_identification_hypothesis':(observed.species_latin||observed.species_common)?'field_report_taxon':'recorded_taxon';
    if(hasLatin)id=match(latin);
    if(!id&&hasCommon)id=match(common);
    if(!id){
      const form=normal(d.species?.growth_form||d.services?.species_class||d.predictions?.predicted_species_class);
      id=/palm/.test(form)?'feather_palm':/conifer/.test(form)?'conifer':/deciduous/.test(form)?'deciduous':/broadleaf/.test(form)?'broadleaf':(hasLatin||hasCommon)?'broadleaf':'unknown';
      basis=form?'growth_form_hypothesis':(hasLatin||hasCommon)?'generic_for_recorded_taxon':'unknown';
    }
    const relatedTemplate=/^metrosideros kermadecensis\b/.test(latin)&&id==='pohutukawa';const automatic=id;
    if(override&&catalogue[override]){id=override;basis='user_selected_hypothesis';}
    const form={...catalogue[id]};
    // Field evidence about the trunk overrides the template's assumption about stems.
    const trunkForm=live?.trunk_form||observed.trunk_form||null;
    if(trunkForm==='multiple'&&(form.stems||1)<2)form.stems=3;
    if(trunkForm==='single')form.stems=1;
    return {id,...form,relatedTemplate,automatic,basis,trunkFormEvidence:trunkForm,recordedName:field?.name||observed.species_latin||observed.species_common||r.species_latin||r.species_common||null,recordedConfidence:r.species_confidence||null,taxonAssertionStatus:r.taxon_assertion_status||null,needsIdentification:!hasLatin&&!hasCommon,needsPhotos:true,templateVersion:'alto-botanical-forms-v3'};
  }

  // ---------- geometry helpers ----------
  function random(seed){let x=2166136261;for(const c of String(seed)){x=Math.imul(x^c.charCodeAt(0),16777619)>>>0;}return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
  const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=a=>Math.hypot(a[0],a[1],a[2]),unit=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
  const GOLD=2.399963;
  // Quadratic Bézier through three points, sampled n times (inclusive).
  function bezier(a,c,b,n){const out=[];for(let i=0;i<=n;i++){const t=i/n,u=1-t;out.push([u*u*a[0]+2*u*t*c[0]+t*t*b[0],u*u*a[1]+2*u*t*c[1]+t*t*b[1],u*u*a[2]+2*u*t*c[2]+t*t*b[2]]);}return out;}

  function meshBuilder(){
    const positions=[],normals=[],colours=[],parts=[];
    function vertex(p,n,c){positions.push(p[0],p[1],p[2]);normals.push(n[0],n[1],n[2]);colours.push(c[0],c[1],c[2],c[3]??1);}
    function triangle(a,b,c,colour){const n=cross(sub(b,a),sub(c,a)),l=len(n);if(l<1e-10)return;const nn=[n[0]/l,n[1]/l,n[2]/l];vertex(a,nn,colour);vertex(b,nn,colour);vertex(c,nn,colour);}
    // Smooth-shaded tube along a polyline with per-point radii. Colour may vary per ring.
    function tube(points,radii,colour,sides=8,mottle=0,rng=null){
      const rings=[],ringN=[];
      for(let i=0;i<points.length;i++){
        const p=points[i],tangent=unit(sub(points[Math.min(i+1,points.length-1)],points[Math.max(0,i-1)])),u=unit(cross(tangent,Math.abs(tangent[1])>.9?[1,0,0]:[0,1,0])),v=cross(tangent,u),r=radii[i];
        const ring=[],rn=[];for(let j=0;j<sides;j++){const a=j*2*Math.PI/sides,n=add(mul(u,Math.cos(a)),mul(v,Math.sin(a)));ring.push(add(p,mul(n,r)));rn.push(n);}rings.push(ring);ringN.push(rn);
      }
      const shade=i=>mottle&&rng?colour.map((c,k)=>k<3?c*(1-mottle*.5+mottle*rng()):c):colour;
      const cols=rings.map((_,i)=>shade(i));
      for(let i=0;i<rings.length-1;i++)for(let j=0;j<sides;j++){const k=(j+1)%sides;
        vertex(rings[i][j],ringN[i][j],cols[i]);vertex(rings[i][k],ringN[i][k],cols[i]);vertex(rings[i+1][j],ringN[i+1][j],cols[i+1]);
        vertex(rings[i][k],ringN[i][k],cols[i]);vertex(rings[i+1][k],ringN[i+1][k],cols[i+1]);vertex(rings[i+1][j],ringN[i+1][j],cols[i+1]);}
      // end caps
      const first=rings[0],last=rings.at(-1),t0=unit(sub(points[0],points[1]||add(points[0],[0,1,0]))),t1=unit(sub(points.at(-1),points.at(-2)||points.at(-1)));
      for(let j=0;j<sides;j++){const k=(j+1)%sides;vertex(points[0],t0,cols[0]);vertex(first[k],t0,cols[0]);vertex(first[j],t0,cols[0]);vertex(points.at(-1),t1,cols.at(-1));vertex(last[j],t1,cols.at(-1));vertex(last[k],t1,cols.at(-1));}
    }
    // A soft foliage mass: an irregular spheroid with smooth normals and a light-to-shade
    // gradient baked into the vertex colour, so it reads as a leafy volume rather than a lump.
    function cluster(centre,radii,colour,phase=0,segments=9,bands=6){
      const ring=[];
      for(let i=0;i<=bands;i++){const phi=i*Math.PI/bands;const row=[];for(let j=0;j<segments;j++){const theta=j*2*Math.PI/segments,k=1+(.14*Math.sin(theta*3+phase)+.08*Math.sin(theta*5+phi*4+phase*1.7))*Math.sin(phi);
        const x=radii[0]*Math.sin(phi)*Math.cos(theta)*k,y=radii[1]*Math.cos(phi)*(1+.07*Math.sin(theta*3+phase)*Math.sin(phi)),z=radii[2]*Math.sin(phi)*Math.sin(theta)*k;
        const n=unit([x/(radii[0]*radii[0]),y/(radii[1]*radii[1]),z/(radii[2]*radii[2])]);const light=.74+.24*(Math.cos(phi)*.5+.5);
        row.push({p:[centre[0]+x,centre[1]+y,centre[2]+z],n,c:[Math.min(.93,colour[0]*light),Math.min(.93,colour[1]*light),Math.min(.93,colour[2]*light),colour[3]??1]});}ring.push(row);}
      for(let i=0;i<bands;i++)for(let j=0;j<segments;j++){const k=(j+1)%segments,a=ring[i][j],b=ring[i+1][j],c=ring[i][k],d=ring[i+1][k];
        if(i>0){vertex(a.p,a.n,a.c);vertex(b.p,b.n,b.c);vertex(c.p,c.n,c.c);}
        if(i<bands-1){vertex(c.p,c.n,c.c);vertex(b.p,b.n,b.c);vertex(d.p,d.n,d.c);}}
    }
    function leaf(a,b,width,colour,bend=0){const side=unit(cross(sub(b,a),[0,1,0]));const middle=add(mix(a,b,.45),[0,bend,0]);const left=add(middle,mul(side,width)),right=add(middle,mul(side,-width)),ridge=add(middle,[0,width*.2,0]);triangle(a,left,ridge,colour);triangle(a,ridge,right,colour);triangle(left,b,ridge,colour);triangle(ridge,b,right,colour);}
    function part(name,fn){const start=positions.length/3;fn();parts.push({name,start,count:positions.length/3-start});}
    return {positions,normals,colours,parts,triangle,tube,cluster,leaf,part};
  }

  // Crown outline: horizontal reach at t (0 = crown base, 1 = top), as a fraction of the
  // maximum radius.
  const ENVELOPE={
    dome:t=>t<.1?.78+.22*t/.1:Math.pow(1-Math.pow((t-.1)/.9,2.3),.55),
    oval:t=>Math.pow(Math.sin(Math.PI*(.04+.92*t)),.8),
    cone:t=>(1-t*.96)*(t<.06?.85+2.5*t:1),
    vase:t=>t<.85?.28+.72*Math.pow(t/.85,.85):Math.sqrt(Math.max(0,1-Math.pow((t-.85)/.15,2)))*.98,
    column:t=>Math.min(1,.8+.5*Math.sin(Math.PI*t)),
    umbrella:t=>t<.6?.22+.78*Math.pow(t/.6,1.7):Math.sqrt(Math.max(0,1-Math.pow((t-.6)/.4,2))),
    weeping:t=>t<.65?.6+.4*Math.pow(t/.65,1.3):1-.4*Math.pow((t-.65)/.35,1.4),
    flat:t=>t<.7?.55+.45*t/.7:1-.7*Math.pow((t-.7)/.3,1.4),
    irregular:t=>Math.pow(Math.sin(Math.PI*(.06+.9*t)),.7)
  };

  function build(p,record){
    const m=meshBuilder(),rng=random(record.tree_id),f=p.architecture,H=p.height,W=p.width,R=W/2,D=Math.max(.02,p.dbh/200),foliageMode=p.foliageMode||'full';
    if(H<=0)return m;
    const bark=[...f.bark,1],green=[...f.foliage,1],mottle=f.mottle||0;
    const leafScale=foliageMode==='sparse'?.72:1,leafKeep=foliageMode==='none'?0:foliageMode==='sparse'?.55:1;
    const tint=()=>{const k=.84+.26*rng();return [green[0]*k,green[1]*k,green[2]*k,1];};
    const shape=f.shape||[1,.8,1];
    // foliage clusters on the outer crown, darker low in the canopy
    const clusters=[];
    const foliage=(centre,size,phase)=>{if(rng()>leafKeep)return;const s=size*leafScale*(.65+.6*rng()),c=tint(),depth=Math.max(0,Math.min(1,(centre[1]-crownBase)/Math.max(.5,H-crownBase)));const k=.86+.16*depth;const rx=s*shape[0]*(.8+.4*rng()),ry=s*shape[1]*(.85+.3*rng()),rz=s*shape[2]*(.8+.4*rng());const y=Math.min(H-ry*.85,Math.max(crownBase*.9+ry*.4,centre[1]));const horiz=Math.hypot(centre[0],centre[2]),lim=Math.max(0,R-rx*.75);const sc=horiz>lim?lim/horiz:1;clusters.push([[centre[0]*sc,y,centre[2]*sc],[rx,ry,rz],[c[0]*k,c[1]*k,c[2]*k,1],phase]);};
    const env=ENVELOPE[f.envelope]||ENVELOPE.dome;
    const crownBase=Math.min(p.base,H*.85),crownDepth=Math.max(H*.15,H-crownBase);
    const reach=t=>R*env(Math.max(0,Math.min(1,t)));
    // Optional vertical density from the laser-return profile: clusters gather where the
    // returns are, without moving the framework.
    const prof=p.profile&&p.profile.length?p.profile:null;
    const density=t=>{if(!prof)return 1;const y=crownBase+t*crownDepth,i=Math.min(prof.length-1,Math.max(0,Math.floor(y*(prof.length/Math.max(H,prof.length)))));const mx=Math.max(...prof)||1;return .5+.5*(prof[i]/mx);};
    const stems=Math.max(1,Math.round(f.stems||1));

    function trunkTo(top,radiusTop,offset=[0,0,0],lean=[0,0]){
      const flare=f.buttress||1.3,pts=[],rad=[];const n=5;
      for(let i=0;i<=n;i++){const t=i/n,y=top*t;pts.push([offset[0]+lean[0]*t*top,y,offset[2]+lean[1]*t*top]);rad.push(i===0?D*flare:i===1?D*1.05:D*(1-(1-radiusTop)*Math.pow((t-.2)/.8,1.2)));}
      m.tube(pts,rad,bark,12,mottle,rng);
    }

    if(f.habit==='palm_feather'||f.habit==='palm_fan'||f.habit==='fern'){
      const fern=f.habit==='fern',fan=f.habit==='palm_fan',top=H*(fern?.62:.74),Dt=D*(f.thick||1);
      m.part('trunk',()=>{
        const pts=[],rad=[];for(let i=0;i<=8;i++){const t=i/8;pts.push([0,top*t,0]);rad.push(Dt*(i===0?1.25:1.02-.12*t));}m.tube(pts,rad,bark,12,mottle,rng);
        // leaf-base rings on the stem
        for(let i=1;i<=16;i++){const y=top*i/17;m.tube([[0,y,0],[0,y+Math.min(.05,H*.006),0]],[Dt*1.06,Dt*1.06],[bark[0]*.9,bark[1]*.9,bark[2]*.9,1],10);}
        if(f.crownshaft)m.tube([[0,top-H*.1,0],[0,top+H*.03,0]],[Dt*.92,Dt*.8],[.33,.44,.23,1],12);
      });
      m.part('crown',()=>{
        const count=f.fronds||16,rise=H*(f.rise||.25),droop=(f.droop||.8),frondTint=()=>{const c=tint();return [c[0]*.62,c[1]*.66,c[2]*.6,1];};
        if(leafKeep>0&&!fern)m.cluster([0,top+H*.06,0],[R*.34,H*.07,R*.34],[green[0]*.7,green[1]*.7,green[2]*.7,1],1,10,6);
        for(let j=0;j<count;j++){
          if(rng()>leafKeep)continue;
          const a=j*GOLD+rng()*.2,tier=j%3,rad=R*(fern?.85:.7+.3*(1-tier/2))*(.9+.2*rng()),start=[0,top+tier*H*.012,0],pts=[];
          for(let i=0;i<=8;i++){const t=i/8;pts.push([rad*t*Math.cos(a),start[1]+rise*Math.sin(t*Math.PI*.8)*(1-tier*.15)-droop*H*.09*t*t,rad*t*Math.sin(a)]);}
          m.tube(pts,pts.map((_,i)=>Math.max(.006,Dt*.07*(1-i/10))),[.38,.44,.22,1],5);
          if(fan){const anchor=pts[4],tip=pts.at(-1);for(let k=-7;k<=7;k++){const b=a+k*.11,target=[tip[0]+R*.3*Math.cos(b),tip[1]-Math.abs(k)*H*.007,tip[2]+R*.3*Math.sin(b)];m.leaf(anchor,target,R*.05,frondTint(),H*.012);}}
          else{for(let i=1;i<8;i++){const t=i/8,c=pts[i],l=R*(fern?.42:f.thick?.4:.32)*Math.sin(t*Math.PI)*leafScale;for(const sign of [-1,1]){const b=a+sign*(fern?1.3:1.15),target=[c[0]+l*Math.cos(b),c[1]-H*(fern?.02:.045)*(1-t),c[2]+l*Math.sin(b)];m.leaf(c,target,Math.max(.012,R*(fern?.035:.024)),frondTint(),H*.02);}}}
        }
        // the emerging central spear fixes the total height
        m.leaf([0,top,0],[R*.05,H,0],Math.max(.02,R*.03),[.30,.42,.22,1]);
      });
    }else if(f.habit==='tufted'){
      const heads=f.heads||5;
      m.part('trunk',()=>trunkTo(H*.42,.75));
      m.part('crown_and_branches',()=>{
        for(let j=0;j<heads;j++){const a=j*GOLD,rr=j?R*(.45+.2*rng()):0,head=[rr*Math.cos(a),H*(j?.66+.1*rng():.8),rr*Math.sin(a)];
          m.tube([[0,H*.34,0],mix([0,H*.45,0],head,.5),head],[D*.7,D*.45,D*.25],bark,8,mottle,rng);
          if(leafKeep===0)continue;
          const n=Math.round(40*leafKeep);for(let k=0;k<n;k++){const b=k*GOLD,up=(k%7)/6,l=R*(.36+.16*(1-up)),end=[head[0]+l*Math.cos(b),head[1]+H*(.22*up-.3*(1-up)*(1-up)+.04),head[2]+l*Math.sin(b)],c=tint(),dead=up<.15&&rng()<.5;m.leaf(head,end,R*.026,dead?[.55,.47,.32,1]:[c[0]*.7,c[1]*.72,c[2]*.66,1],H*.02);}
        }});
    }else if(f.habit==='excurrent'){
      const whorls=f.whorls||10,per=f.perWhorl||6,droop=f.droop||0,top=H*.985;
      m.part('trunk',()=>trunkTo(top,.05));
      m.part('crown_and_branches',()=>{
        const y0=crownBase,y1=H*.93;
        for(let w=0;w<whorls;w++){
          const t=whorls>1?w/(whorls-1):0,y=y0+(y1-y0)*t,rot=w*(f.tiered?.31:.9)+rng()*.3,L=reach(t)*(f.tiered?1:.9+.2*rng()),n=f.tiered?per:per+(w%2);
          if(L<D*2){foliage([0,y,0],Math.max(.25,R*.12),w);continue;}
          for(let j=0;j<n;j++){
            const a=rot+j*2*Math.PI/n+(f.tiered?0:rng()*.25),dir=[Math.cos(a),0,Math.sin(a)];
            const start=[0,y,0],end=add(mul(dir,L),[0,y+droop*L*(f.tiered?1:.6+.8*rng()),0]),ctrl=add(mul(dir,L*.5),[0,y+L*(droop<0?-.05:.1)*.5,0]);
            const pts=bezier(start,ctrl,end,5);m.tube(pts,pts.map((_,i)=>Math.max(.008,D*(.28-.2*t)*(1-i/6))),bark,6);
            for(let s=.4;s<=1.01;s+=.3){const c=mix(pts[Math.floor(s*5)],pts[Math.min(5,Math.ceil(s*5))],s*5%1),sz=Math.max(.15,L*(f.cluster||.12)*2.2*(s<.99?.85:1))*density(t);foliage(c,sz*(f.tiered?1.2:1),a+s);}
          }
        }
        foliage([0,H*.96,0],Math.max(.2,R*.12),0);
        for(const [c,sz,col,ph] of clusters)m.cluster(c,sz,col,ph);
      });
    }else{
      // Decurrent habits, umbrellas and weepers: a trunk that forks, three orders of branch
      // reaching for the envelope, foliage on the outer framework and the crown surface.
      const fork=Math.min(f.trunk*H,crownBase*1.05,H*.8),limbs=f.limbs||7,subs=f.sub||3,twigs=f.twigs||2,angle=(f.angle||50)*Math.PI/180,arch=f.arch||0,spread=f.spread||.9;
      const stemTops=[];
      m.part('trunk',()=>{
        if(stems===1){trunkTo(fork,.72);stemTops.push({top:[0,fork,0],r:D*.72});}
        else{
          // equivalent basal area shared across the stems, not one full DBH each
          const shares=stems===2?[.55,.45]:[.45,.32,.23,.18,.14].slice(0,stems);const total=shares.reduce((a,b)=>a+b,0);
          shares.forEach((share,j)=>{const a=j*GOLD+.4,rd=D*Math.sqrt(share/total),lean=[Math.cos(a)*R*.22/Math.max(fork,.5),Math.sin(a)*R*.22/Math.max(fork,.5)],off=[Math.cos(a)*D*.6,0,Math.sin(a)*D*.6];
            const pts=[],rad=[];for(let i=0;i<=5;i++){const t=i/5,y=fork*(.85+.3*j*.1)*t;pts.push([off[0]+lean[0]*y*(1+.3*t),y,off[2]+lean[1]*y*(1+.3*t)]);rad.push(i===0?rd*1.3:rd*(1-.3*t));}
            m.tube(pts,rad,bark,10,mottle,rng);stemTops.push({top:pts.at(-1),r:rd*.7});});
        }
      });
      m.part('crown_and_branches',()=>{
        const tips=[];
        for(let j=0;j<limbs;j++){
          const stem=stemTops[j%stemTops.length],a=j*GOLD+rng()*.5,dir=[Math.cos(a),0,Math.sin(a)];
          const lt=f.limbT||[.08,.62],tTarget=lt[0]+(lt[1]-lt[0])*rng(),Lr=reach(tTarget)*spread*(.65+.3*rng()),yTarget=crownBase+tTarget*crownDepth;
          const start=add(stem.top,[dir[0]*stem.r*.6,-fork*.12*rng(),dir[2]*stem.r*.6]);
          const end=[dir[0]*Lr,yTarget+arch*H*.2,dir[2]*Lr];
          // leave the trunk at the habit's angle, then bend toward the target
          const l1=Math.min(Lr*.45,crownDepth*.4),elbow=add(start,[dir[0]*Math.sin(angle)*l1,Math.cos(angle)*l1+arch*H*.25,dir[2]*Math.sin(angle)*l1]);
          const pts=bezier(start,elbow,end,6),r0=Math.max(.02,stem.r*.78/Math.sqrt(limbs/4)),r1=r0*.32;
          m.tube(pts,pts.map((_,i)=>Math.max(.012,r0+(r1-r0)*i/6)),bark,7,mottle*.6,rng);
          for(let s=0;s<subs;s++){
            const u=.45+.45*rng(),k=Math.floor(u*6),base=mix(pts[k],pts[Math.min(6,k+1)],u*6-k),b=a+(s-(subs-1)/2)*.6+rng()*.3-.15;
            const t2=Math.max(.02,Math.min(1,tTarget-.12+.45*rng())),L2=reach(t2)*spread*(.8+.2*rng()),end2=[Math.cos(b)*L2,crownBase+t2*crownDepth,Math.sin(b)*L2];
            const c2=add(mix(base,end2,.5),[0,crownDepth*.08+arch*H*.1,0]),pts2=bezier(base,c2,end2,4);
            m.tube(pts2,pts2.map((_,i)=>Math.max(.008,r1*(1.1-i/5))),bark,6);
            tips.push({p:end2,a:b,t:t2});
            if(leafKeep>0)foliage(mix(pts2[2],pts2[3],.5),R*f.cluster*.75*density(t2),b);
            for(let w=0;w<twigs;w++){
              const v=.5+.45*rng(),kk=Math.floor(v*4),base3=mix(pts2[kk],pts2[Math.min(4,kk+1)],v*4-kk),c=b+(w-(twigs-1)/2)*.7+rng()*.4-.2,t3=Math.max(.02,Math.min(1,t2-.08+.25*rng())),L3=reach(t3)*spread*(.92+.1*rng());
              const end3=[Math.cos(c)*L3,crownBase+t3*crownDepth+(f.habit==='weeping'?0:crownDepth*.04),Math.sin(c)*L3],pts3=bezier(base3,add(mix(base3,end3,.5),[0,crownDepth*.05,0]),end3,3);
              m.tube(pts3,pts3.map((_,i)=>Math.max(.006,r1*.45*(1-i/4))),bark,5);tips.push({p:end3,a:c,t:t3});
            }
          }
          if(leafKeep>0)foliage(mix(pts[4],pts[5],.5),R*f.cluster*.6*density(tTarget),a);
        }
        // Foliage: every tip carries a mass, then the crown surface is filled so the outline
        // matches the habit. Each surface mass gets a twig back to the nearest tip.
        if(leafKeep>0){
          const size=R*f.cluster;
          for(const tip of tips)foliage(tip.p,size*(.9+.3*rng())*density(tip.t),tip.a);
          const extra=Math.max(0,(f.clusters||100)-tips.length);
          for(let i=0;i<extra;i++){
            let t;do{t=.04+.96*rng();}while(rng()>density(t)*.95+.05);
            const a=i*GOLD+rng(),rr=Math.max(0,reach(t)-size*.7*shape[0]),c=[rr*Math.cos(a),crownBase+t*crownDepth,rr*Math.sin(a)];
            let near=null,best=Infinity;for(const tip of tips){const dd=len(sub(tip.p,c));if(dd<best){best=dd;near=tip;}}
            if(near&&best>size*.4){const pts=bezier(near.p,add(mix(near.p,c,.5),[0,size*.2,0]),c,2);m.tube(pts,[.02,.014,.008].map(v=>Math.max(.005,v*Math.sqrt(R))),bark,4);}
            foliage(c,size*(.85+.35*rng()),a);
          }
          // pendulous curtains for weeping habits
          if(f.habit==='weeping'){
            const drop=(f.pendant||.5)*crownDepth;
            for(const tip of tips){if(rng()>.6)continue;for(let s=0;s<1;s++){const dx=(rng()-.5)*size*2,dz=(rng()-.5)*size*2,d=drop*(.5+.5*rng()),pts=[tip.p,add(tip.p,[dx*.6,-d*.35,dz*.6]),add(tip.p,[dx,-d*.7,dz]),add(tip.p,[dx*1.1,-d,dz*1.1])];
              m.tube(pts,[.03,.02,.014,.008].map(v=>v*Math.sqrt(R)),[bark[0]*.8,bark[1]*.8,bark[2]*.8,1],4);
              for(let q=1;q<4;q+=2)foliage(pts[q],size*(.6+.3*rng()),tip.a+q);}}
          }
        }
        for(const [c,s,col,ph] of clusters)m.cluster(c,s,col,ph);
      });
    }
    // Fit the crown to the recorded height and reach; trunk radii stay in physical units.
    let top=0,extent=0;
    for(let i=0;i<m.positions.length;i+=3)top=Math.max(top,m.positions[i+1]);
    for(const part of m.parts.filter(x=>x.name!=='trunk'))for(let i=part.start*3;i<(part.start+part.count)*3;i+=3)extent=Math.max(extent,Math.hypot(m.positions[i],m.positions[i+2]));
    const horizontal=extent>0?R/extent:1,vertical=top>0?H/top:1;
    for(const part of m.parts)for(let i=part.start*3;i<(part.start+part.count)*3;i+=3){
      const h=part.name!=='trunk'?horizontal:1;m.positions[i]*=h;m.positions[i+2]*=h;m.positions[i+1]*=vertical;
      // normals transform by the inverse scale
      const nx=m.normals[i]/h,ny=m.normals[i+1]/vertical,nz=m.normals[i+2]/h,l=Math.hypot(nx,ny,nz)||1;m.normals[i]=nx/l;m.normals[i+1]=ny/l;m.normals[i+2]=nz/l;
    }
    m.fit={horizontal,vertical,clusters:clusters.length,triangles:m.positions.length/9};
    return m;
  }

  function roots(p,record,depth=.6,extentKey='effective_radius_m'){
    const m=meshBuilder(),r=record.datasets?.roots||{},radius=Number(r[extentKey]);
    if(!Number.isFinite(radius)||radius<=0)return {...m,rootInfo:{available:false,reason:'No positive stored radius for this root scenario.'}};
    const maxDepth=Number.isFinite(Number(depth))?Math.max(.2,Math.min(2,Number(depth))):.6,rng=random(record.tree_id+'roots'),fibrous=p.architecture.rootForm==='fibrous',n=fibrous?40:11;
    m.part('roots_hypothesis',()=>{for(let i=0;i<n;i++){
      const a=i*GOLD+rng()*.3,l=radius*(.72+.28*rng()),dip=maxDepth*(.35+.65*rng()),points=Array.from({length:6},(_,j)=>{const t=j/5,b=a+.22*Math.sin(t*4+i);return [l*t*Math.cos(b),-Math.min(dip,maxDepth)*Math.sin(t*Math.PI*.5),l*t*Math.sin(b)];});
      const thick=fibrous?Math.max(.008,Math.min(.018,p.dbh/200*.035)):p.dbh/200*(.25+.1*rng());
      m.tube(points,points.map((_,j)=>Math.max(.003,thick*(1-j/5)*.95)),fibrous?[.56,.42,.28,1]:[.49,.35,.24,1],5);
      if(!fibrous)for(let j=2;j<5;j++)for(const side of [-1,1]){const start=points[j],b=a+side*.60,end=[start[0]+l*.20*Math.cos(b),Math.max(-maxDepth,start[1]-maxDepth*.13),start[2]+l*.20*Math.sin(b)];const reach=Math.hypot(end[0],end[2]);if(reach>radius){end[0]*=radius/reach;end[2]*=radius/reach;}m.tube([start,mix(start,end,.5),end],[thick*.28,thick*.12,.003],[.57,.42,.28,1],5);}
    }});
    return {...m,rootInfo:{available:true,method_id:'alto-root-architecture-scenario-v1',radius_m:radius,radius_field:extentKey,depth_m:maxDepth,depth_basis:'User-adjustable illustration assumption; no root-depth observation is stored',architecture:fibrous?'fibrous root hypothesis':'branching woody-root hypothesis',root_paths:'Procedural illustration; not detected roots or mapped underground obstacles',life_stage:r.life_stage||null,life_stage_used_to_infer_depth:false}};
  }
  root.ALTOTreeArchitecture={catalogue,identify,match,build,roots,meshBuilder,version:'alto-botanical-forms-v3'};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.ALTOTreeArchitecture;
})(typeof globalThis==='undefined'?window:globalThis);
