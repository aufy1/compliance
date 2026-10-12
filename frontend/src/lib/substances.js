/* Definicje substancji i mapowanie na pozycje BOMcheck RCD (przeniesione 1:1 z helpera v12) */
export const SEC={rohs:'RoHS Restrictions',rohs2:'RoHS Amendments 1',reach67:'REACH Restrictions (Art. 67)',pops:'POPs',other:'Other Restricted or Declarable',tsca:'TSCA 6(h)',svhc:'REACH Candidate List (SVHC)',pfas:'BOMcheck PFAS List',crm:'Critical Raw Materials',prop65:'California Prop 65',soc:'Substance of Concern (SoC)',industry:'Industry Restricted and Declarable'};
export const SECCOL={rohs:'red',rohs2:'red',reach67:'orange',pops:'rose',other:'slate',tsca:'slate',svhc:'amber',pfas:'cyan',crm:'emerald',prop65:'violet',soc:'fuchsia',industry:'sky'};
export const SOC={s:'soc',x:'Substances of Concern',a:'No'};
export const BFR={s:'industry',x:'Brominated flame retardants (other than PBBs, PBDEs or HBCDD)',a:'No'};
export const PFAS_NO={s:'pfas',x:'Per- and polyfluoroalkyl substances (BOMcheck)',a:'No'};
export const G=[
 {g:'Metale, stopy i powłoki',items:[
  {id:'pb',n:'Ołów (Pb) – mosiądz/brąz, stal automatowa',en:'Lead',cas:['7439-92-1'],cnt:628,note:'Deklaruj spójnie: RoHS, REACH SVHC, Prop 65, SoC. Wyjątek RoHS wybierasz ręcznie w oknie.',t:[{s:'rohs',x:'Lead/lead compounds',a:'EX'},{s:'svhc',x:'Lead',a:'No'},{s:'prop65',x:'Lead and Lead Compounds',a:'No'},SOC]},
  {id:'cu',n:'Miedź i stopy Cu',en:'Copper, copper alloys (brass, bronze)',cas:['7440-50-8'],cnt:851,t:[{s:'crm',x:'Copper/copper compounds',a:'No'}]},
  {id:'ni',n:'Nikiel – powłoki Ni',en:'Nickel, nickel plating',cas:['7440-02-0'],cnt:152,t:[{s:'crm',x:'Nickel/nickel compounds',a:'No'}]},
  {id:'pm',n:'Metale szlachetne – złoto, srebro',en:'Precious metals – gold, silver',cas:['7440-57-5','7440-22-4'],cnt:364,note:'Platynowce (Pt, Pd, Ir, Ru, Os, Rh) → osobna pozycja poniżej.',t:[{s:'industry',x:'Precious metals',a:'No'}],info:[
    {n:'Złoto (Au)',en:'Gold',cas:'7440-57-5'},{n:'Srebro (Ag)',en:'Silver',cas:'7440-22-4'}]},
  {id:'pgm',n:'Pallad / platynowce (PGM)',en:'Palladium, platinum group metals',cas:['7440-05-3','7440-06-4','7439-88-5','7440-18-8','7440-04-2','7440-16-6'],cnt:5,note:'Zaznacza oba: Precious metals + Critical Raw Materials → PGM.',t:[{s:'industry',x:'Precious metals',a:'No'},{s:'crm',x:'Platinum group metals/PGM compounds',a:'No'}],info:[
    {n:'Pallad (Pd)',en:'Palladium',cas:'7440-05-3'},{n:'Platyna (Pt)',en:'Platinum',cas:'7440-06-4'},{n:'Iryd (Ir)',en:'Iridium',cas:'7439-88-5'},
    {n:'Ruten (Ru)',en:'Ruthenium',cas:'7440-18-8'},{n:'Osm (Os)',en:'Osmium',cas:'7440-04-2'},{n:'Rod (Rh)',en:'Rhodium',cas:'7440-16-6'}]},
  {id:'pbz',n:'Brąz fosforowy (CuSnP)',en:'Phosphor bronze, phosphorus',cas:['7723-14-0'],cnt:50,t:[{s:'crm',x:'Phosphorus/phosphorus compounds',a:'No'}]},
  {id:'be',n:'Beryl – BeCu',en:'Beryllium, beryllium copper',cas:['7440-41-7'],cnt:49,t:[{s:'industry',x:'Beryllium and Beryllium Compounds',a:'No'},{s:'crm',x:'Beryllium/beryllium compounds',a:'No'}]},
  {id:'mn',n:'Mangan – stal, stopy',en:'Manganese',cas:['7439-96-5'],cnt:155,t:[{s:'crm',x:'Manganese/manganese compounds',a:'No'}]},
  {id:'co',n:'Kobalt',en:'Cobalt',cas:['7440-48-4'],cnt:6,t:[{s:'crm',x:'Cobalt/cobalt compounds',a:'No'}]},
  {id:'al',n:'Aluminium – folia ekranu',en:'Aluminium, aluminum foil, bauxite',cas:['7429-90-5'],cnt:44,warn:'Do decyzji (pozycja CRM dotyczy boksytu).',t:[{s:'crm',x:'Bauxite/aluminium ores and concentrates',a:'No'}]},
  {id:'cd',n:'Kadm / tlenek kadmu (powłoki, styki)',en:'Cadmium, cadmium oxide',cas:['7440-43-9','1306-19-0'],cnt:5,warn:'RoHS: Cd > 0,01% bez wyjątku = niezgodność. Tylko po potwierdzeniu.',t:[{s:'rohs',x:'Cadmium/Cadmium compounds',a:'No'},{s:'svhc',x:'Cadmium',a:'No'},{s:'svhc',x:'Cadmium oxide',a:'No'},SOC]},
  {id:'cr6',n:'Chrom VI (chromianowanie żółte)',en:'Hexavalent chromium, chromate coating',cas:['18540-29-9'],cnt:8,warn:'RoHS: Cr(VI) = niezgodność. Chromianowanie bywa Cr(III) – sprawdź u dostawcy.',t:[{s:'rohs',x:'Hexavalent Chromium',a:'No'}]},
  {id:'ree',n:'Neodym / dysproz (magnesy)',en:'Neodymium, dysprosium, rare earth elements',cas:['7440-00-8','7429-91-6'],cnt:7,t:[{s:'industry',x:'Rare earth minerals',a:'No'},{s:'crm',x:'Light rare earth elements/LREE compounds',a:'No'},{s:'crm',x:'Heavy rare earth elements/HREE compounds',a:'No'}]},
  {id:'li',n:'Nadchloran litu (elektrolit)',en:'Lithium perchlorate',cas:['7791-03-9'],cnt:2,t:[{s:'crm',x:'Lithium/lithium compounds',a:'No'}]},
 ]},
 {g:'Tworzywa i uniepalniacze',items:[
  {id:'pvc',n:'PVC',en:'Polyvinyl chloride',cas:['9002-86-2'],cnt:965,t:[{s:'industry',x:'PVC and PVC copolymers',a:'No'}]},
  {id:'sb',n:'Sb2O3 – uniepalniacz',en:'Antimony trioxide, antimony oxide',cas:['1309-64-4'],cnt:227,t:[{s:'prop65',x:'Antimony Oxide (Antimony trioxide)',a:'No'},{s:'industry',x:'Antimony trioxide in plastic materials',a:'No'},{s:'crm',x:'Antimony/antimony compounds',a:'No'},SOC]},
  {id:'dinp',n:'DINP',en:'Diisononyl phthalate',cas:['28553-12-0','68515-48-0'],cnt:82,t:[{s:'prop65',x:'Diisononyl phthalate (DiNP)',a:'No'},{s:'industry',x:'Phthalates',a:'No'}]},
  {id:'didp',n:'DIDP',en:'Diisodecyl phthalate',cas:['26761-40-0','68515-49-1'],cnt:45,t:[{s:'prop65',x:'Di-isodecyl phthalate (DIDP)',a:'No'},{s:'industry',x:'Phthalates',a:'No'}]},
  {id:'dup',n:'DUP / inne ftalany',en:'Diundecyl phthalate, other phthalates',cas:['3648-20-2'],cnt:3,t:[{s:'industry',x:'Phthalates',a:'No'}]},
  {id:'bfr',n:'BFR – ogólnie',en:'Brominated flame retardants',cas:[],cnt:223,t:[BFR]},
  {id:'dbdpe',n:'DBDPE',en:'Decabromodiphenyl ethane, 1,2-bis(pentabromophenyl)ethane',cas:['84852-53-9'],cnt:31,t:[{s:'svhc',x:"1,1'-(ethane-1,2-diyl)bis[pentabromobenzene]",m:'prefix',a:'No'},BFR,SOC]},
  {id:'tbph',n:'TBPH',en:'Bis(2-ethylhexyl) tetrabromophthalate',cas:['26040-51-7'],cnt:3,t:[{s:'svhc',x:'bis(2-ethylhexyl) tetrabromophthalate',m:'prefix',a:'No'},BFR,SOC]},
  {id:'dp',n:'Dechlorane Plus',en:'Dechlorane Plus, chlorinated flame retardant',cas:['13560-89-9'],cnt:4,warn:'POPs „No” = niezgodność – eskaluj.',t:[{s:'pops',x:'Dechlorane Plus',a:'No'},{s:'svhc',x:'Dechlorane Plus',a:'No'},{s:'industry',x:'Chlorinated flame retardants',a:'No'},SOC]},
  {id:'pfas',n:'PTFE / FEP / PFPE / PVDF (PFAS)',en:'Fluoropolymers: polytetrafluoroethylene, fluorinated ethylene propylene, perfluoropolyether, polyvinylidene fluoride',cas:['9002-84-0','25067-11-2','69991-61-3','24937-79-9'],cnt:136,t:[PFAS_NO]},
  {id:'ppfp',n:'Polypropylene-fluoropolymer',en:'Polypropylene-fluoropolymer, PP with fluoropolymer additive',cas:[],cnt:null,note:'Brak potwierdzenia PFAS → PFAS = Missing. Jeśli zaznaczysz też inną pozycję z PFAS (np. PTFE/FEP, PFBS), wygrywa „No”.',t:[{s:'pfas',x:'Per- and polyfluoroalkyl substances (BOMcheck)',a:'Missing'}]},
  {id:'pfbs',n:'PFBS (kwas perfluorobutanosulfonowy)',en:'Perfluorobutane sulfonic acid',cas:['375-73-5'],cnt:4,t:[{s:'svhc',x:'Perfluorobutane sulfonic acid (PFBS)',m:'prefix',a:'No'},PFAS_NO,SOC]},
  {id:'mg',n:'Mg(OH)2 – LSZH',en:'Magnesium hydroxide',cas:['1309-42-8'],cnt:35,t:[{s:'crm',x:'Magnesium/magnesium compounds',a:'No'}]},
  {id:'b',n:'Boran cynku',en:'Zinc borate, boron',cas:['138265-88-0'],cnt:32,t:[{s:'crm',x:'Boron/borates/boron compounds',a:'No'}]},
  {id:'ti',n:'TiO2 – pigment',en:'Titanium dioxide',cas:['13463-67-7'],cnt:32,t:[{s:'crm',x:'Titanium metal/titanium compounds',a:'No'}]},
  {id:'ba',n:'Związki baru (BaSO4)',en:'Barium sulphate, barium compounds, baryte',cas:['7727-43-7'],cnt:3,t:[{s:'crm',x:'Baryte/barium compounds',a:'No'}]},
  {id:'mel',n:'Melamina / cyjanuran melaminy (PA FR)',en:'Melamine, melamine cyanurate',cas:['108-78-1','37640-57-6'],cnt:3,t:[{s:'svhc',x:'Melamine',a:'No'},SOC]},
 ]},
 {g:'Rzadkie – tylko na podstawie deklaracji',items:[
  {id:'dehp',n:'DEHP > 0,1%',en:'Bis(2-ethylhexyl) phthalate, di(2-ethylhexyl) phthalate',cas:['117-81-7'],cnt:20,warn:'RoHS „No” = niezgodność. W pliku są wpisy „DEHP > 15%” i „DEHP issue” – zaznacz tylko po potwierdzeniu.',t:[{s:'rohs2',x:'Bis(2-ethylhexyl) phthalate (DEHP)',a:'No'},{s:'svhc',x:'DEHP (Di(2-ethylhexyl) phthalate)',a:'No'},{s:'reach67',x:'Sum of Selected Phthalates Group 1',m:'prefix',a:'No'},{s:'industry',x:'Phthalates',a:'No'},SOC]},
  {id:'latex',n:'Lateks (kauczuk naturalny)',en:'Natural rubber latex',cas:['9006-04-6'],cnt:16,t:[{s:'other',x:'Latex',a:'No'}]},
  {id:'dbmc',n:'DBMC – przeciwutleniacz w gumie/tworzywach',en:"6,6'-di-tert-butyl-2,2'-methylenedi-p-cresol",cas:['119-47-1'],cnt:13,t:[{s:'svhc',x:"6,6'-di-tert-butyl-2,2'-methylenedi-p-cresol",m:'prefix',a:'No'},SOC]},
  {id:'bpa',n:'Bisfenol A',en:'Bisphenol A',cas:['80-05-7'],cnt:10,t:[{s:'svhc',x:'4,4-isopropylidenediphenol [Bisphenol A',m:'prefix',a:'No'},{s:'prop65',x:'Bisphenol A (BPA)',a:'No'},SOC]},
  {id:'sil',n:'Siloksany D4/D5/D6',en:'Siloxanes: octamethylcyclotetrasiloxane, decamethylcyclopentasiloxane, dodecamethylcyclohexasiloxane',cas:['556-67-2','541-02-6','540-97-6'],cnt:4,t:[{s:'svhc',x:'Octamethylcyclotetrasiloxane',m:'prefix',a:'No'},{s:'svhc',x:'Decamethylcyclopentasiloxane',m:'prefix',a:'No'},{s:'svhc',x:'Dodecamethylcyclohexasiloxane',m:'prefix',a:'No'},SOC]},
  {id:'tpp',n:'Fosforan trifenylu (TPP)',en:'Triphenyl phosphate',cas:['115-86-6'],cnt:3,t:[{s:'svhc',x:'Triphenyl phosphate',a:'No'},SOC]},
  {id:'adca',n:'Azodikarbonamid (spieniony PP)',en:'Azodicarbonamide, diazene-1,2-dicarboxamide',cas:['123-77-3'],cnt:2,t:[{s:'svhc',x:'Diazene-1,2-dicarboxamide',m:'prefix',a:'No'},SOC]},
 ]},
 {g:'Braki danych (z BOM)',items:[
  {id:'pfasu',n:'PFAS – brak danych od dostawcy',en:'PFAS unknown, missing supplier data',cas:[],cnt:null,note:'Ustawia BOMcheck PFAS = Missing. Jeśli w BOM jest materiał z PFAS (PTFE/FEP/PFBS), wygrywa „No”.',t:[{s:'pfas',x:'Per- and polyfluoroalkyl substances (BOMcheck)',a:'Missing'}]},
  {id:'pipu',n:'PIP (3:1) – brak danych (TSCA)',en:'Phenol, isopropylated phosphate (3:1) unknown',cas:['68937-41-7'],cnt:null,note:'Pozycja TSCA dopasowywana po początku nazwy „Phenol, isopropylated phosphate…”.',t:[{s:'tsca',x:'Phenol, isopropylated phosphate',m:'prefix',a:'Missing'}]},
 ]},
];
export const PRESETS={
  typical:['pb','cu','ni','pm','pbz','mn','pvc','sb','dinp','bfr','dbdpe'],
  pvcnopb:['cu','ni','pm','pbz','mn','pvc','sb','dinp','bfr','dbdpe'],
  lszh:['pb','cu','ni','pm','pbz','mn','mg','b'],
  coax:['pb','cu','ni','pm','pbz','mn','pfas'],
  clear:[]};

export const ALL = G.flatMap(g => g.items);
export const BY_ID = Object.fromEntries(ALL.map(i => [i.id, i]));
export const RANK = { Missing: 1, No: 2, EX: 3 };
/* substancje, które można przypisać do rekordu w bazie (bez pozycji „Braki danych”) */
export const ASSIGNABLE_GROUPS = G.filter(g => !g.items.every(i => i.id.endsWith('u')));
