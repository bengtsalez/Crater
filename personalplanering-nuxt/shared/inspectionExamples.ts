// Exempelmallar som ett företag uttryckligen kan lägga till ("Lägg till
// exempelmallar"). De är underlag att anpassa – inga tekniska gränsvärden,
// certifieringar eller påståenden om regelefterlevnad. Projektets krav och
// produktanvisningar fylls i av projektledaren.

import type { AnswerType, InspectionKind, TemplateItem, TemplateSection } from './inspections'

export const EXAMPLE_NOTE =
  'Exempelmall – underlag som projektledaren behöver anpassa till projektets krav, ritningar och produktanvisningar före användning.'

type ItemSpec = Partial<TemplateItem> & { title: string }

let counter = 0
function item(prefix: string, spec: ItemSpec): TemplateItem {
  counter++
  return {
    key: `${prefix}-${counter}`,
    title: spec.title,
    instruction: spec.instruction ?? null,
    basis: spec.basis ?? null,
    basis_url: null,
    method: spec.method ?? null,
    answer_type: (spec.answer_type ?? 'result') as AnswerType,
    unit: spec.unit ?? null,
    required: spec.required ?? true,
    min_photos: spec.min_photos ?? 0,
    comment_required: spec.comment_required ?? false,
    critical: spec.critical ?? false,
    timing_note: spec.timing_note ?? null,
  }
}

function sections(prefix: string, spec: [string, ItemSpec[]][]): TemplateSection[] {
  counter = 0
  return spec.map(([title, items]) => ({ title, items: items.map((i) => item(prefix, i)) }))
}

export interface ExampleTemplate {
  example_key: string
  name: string
  kind: InspectionKind
  description: string
  sections: TemplateSection[]
}

const PROJ = 'Enligt projektets handlingar'

export const EXAMPLE_TEMPLATES: ExampleTemplate[] = [
  {
    example_key: 'drainage_v1',
    name: 'Dränering (exempel)',
    kind: 'self_inspection',
    description: EXAMPLE_NOTE,
    sections: sections('dr', [
      [
        'Före start',
        [
          { title: 'Ledningar och kablar i mark är utsatta/kontrollerade', basis: 'Ledningsanvisning / kabelutsättning', method: 'Visuell kontroll', critical: true, timing_note: 'Innan grävning påbörjas' },
          { title: 'Arbetsområdet är avspärrat och skyddat', method: 'Visuell kontroll' },
          { title: 'Befintliga skador på fasad och mark är dokumenterade', method: 'Fotodokumentation', min_photos: 1 },
        ],
      ],
      [
        'Efter friläggning',
        [
          { title: 'Grundmurens skick är bedömt', method: 'Visuell kontroll', comment_required: true, min_photos: 1 },
          { title: 'Schaktdjup enligt handling', basis: PROJ, method: 'Mätning', answer_type: 'number', unit: 'm' },
          { title: 'Schaktbotten är fri från organiskt material och vatten', method: 'Visuell kontroll' },
        ],
      ],
      [
        'Montering',
        [
          { title: 'Fuktskydd/isolering monterad enligt produktanvisning', basis: 'Produktanvisning för valt system', method: 'Visuell kontroll', min_photos: 1, critical: true, timing_note: 'Innan återfyllning' },
          { title: 'Valt system och produkter', method: 'Anteckning', answer_type: 'text', required: false },
        ],
      ],
      [
        'Ledningar',
        [
          { title: 'Dräneringsledning lagd med fall enligt handling', basis: PROJ, method: 'Mätning/avvägning', min_photos: 1, critical: true, timing_note: 'Innan ledningen täcks' },
          { title: 'Spolbrunnar/inspektionsbrunnar placerade enligt handling', basis: PROJ, method: 'Visuell kontroll' },
          { title: 'Anslutning till dagvatten/ledningsnät kontrollerad', basis: PROJ, method: 'Visuell kontroll' },
        ],
      ],
      [
        'Före återfyllning',
        [
          { title: 'Omfyllnadsmaterial enligt handling', basis: PROJ, method: 'Visuell kontroll', critical: true, timing_note: 'Innan återfyllning' },
          { title: 'Spolning/funktionskontroll av ledning utförd', method: 'Funktionskontroll', min_photos: 1 },
        ],
      ],
      [
        'Återställning',
        [
          { title: 'Mark återställd enligt överenskommelse', method: 'Visuell kontroll', min_photos: 1 },
          { title: 'Arbetsplatsen städad', method: 'Visuell kontroll', answer_type: 'checkbox' },
        ],
      ],
    ]),
  },
  {
    example_key: 'facade_v1',
    name: 'Fasad (exempel)',
    kind: 'self_inspection',
    description: EXAMPLE_NOTE,
    sections: sections('fa', [
      [
        'Underlag',
        [
          { title: 'Underlagets skick och bärighet bedömt', method: 'Visuell kontroll', comment_required: true, min_photos: 1, critical: true, timing_note: 'Innan systemet monteras' },
          { title: 'Underlaget är rent, torrt och förberett enligt produktanvisning', basis: 'Produktanvisning för valt system', method: 'Visuell kontroll' },
        ],
      ],
      [
        'Valt system',
        [
          { title: 'Fasadsystem och produkter enligt handling', basis: PROJ, method: 'Anteckning', answer_type: 'text' },
          { title: 'Produktdatablad/monteringsanvisning finns på arbetsplatsen', method: 'Visuell kontroll' },
        ],
      ],
      [
        'Infästning eller armering enligt anvisning',
        [
          { title: 'Infästning/armering utförd enligt systemanvisning', basis: 'Systemanvisning', method: 'Visuell kontroll', min_photos: 1, critical: true, timing_note: 'Innan nästa skikt' },
          { title: 'Väderförhållanden under arbetet noterade', method: 'Anteckning', answer_type: 'text', required: false },
        ],
      ],
      [
        'Anslutningar',
        [
          { title: 'Anslutningar mot fönster, dörrar och tak utförda enligt handling', basis: PROJ, method: 'Visuell kontroll', min_photos: 1 },
          { title: 'Plåt- och sockelanslutningar kontrollerade', method: 'Visuell kontroll' },
        ],
      ],
      [
        'Slutkontroll',
        [
          { title: 'Ytan är jämn och fri från synliga skador', method: 'Visuell kontroll', min_photos: 2 },
          { title: 'Ställning och skydd demonterade, området städat', method: 'Visuell kontroll', answer_type: 'checkbox' },
        ],
      ],
    ]),
  },
  {
    example_key: 'paving_v1',
    name: 'Stensättning (exempel)',
    kind: 'self_inspection',
    description: EXAMPLE_NOTE,
    sections: sections('st', [
      [
        'Undergrund',
        [
          { title: 'Undergrunden är urschaktad till djup enligt handling', basis: PROJ, method: 'Mätning', answer_type: 'number', unit: 'mm', critical: true, timing_note: 'Innan bärlager läggs' },
          { title: 'Undergrunden är fri från organiskt material', method: 'Visuell kontroll', min_photos: 1 },
        ],
      ],
      [
        'Bärlager',
        [
          { title: 'Material i bärlager enligt handling', basis: PROJ, method: 'Visuell kontroll' },
          { title: 'Packning utförd i lager enligt handling', basis: PROJ, method: 'Visuell kontroll', comment_required: true },
        ],
      ],
      [
        'Nivåer och fall',
        [
          { title: 'Nivåer kontrollerade mot handling', basis: PROJ, method: 'Avvägning', min_photos: 1, critical: true, timing_note: 'Innan läggning' },
          { title: 'Fall från byggnad kontrollerat', basis: PROJ, method: 'Mätning' },
        ],
      ],
      [
        'Läggning',
        [
          { title: 'Sättsand/sättlager enligt handling', basis: PROJ, method: 'Visuell kontroll' },
          { title: 'Mönster och fogbredd enligt överenskommelse', method: 'Visuell kontroll', min_photos: 1 },
          { title: 'Kantstöd monterade', method: 'Visuell kontroll' },
        ],
      ],
      [
        'Återställning',
        [
          { title: 'Fogning och avslutande vibrering utförd', method: 'Visuell kontroll' },
          { title: 'Angränsande ytor återställda och städade', method: 'Visuell kontroll', min_photos: 1 },
        ],
      ],
    ]),
  },
  {
    example_key: 'site_setup_v1',
    name: 'Etablering och avetablering (exempel)',
    kind: 'checklist',
    description: EXAMPLE_NOTE,
    sections: sections('et', [
      [
        'Etablering',
        [
          { title: 'Arbetsområdet avspärrat och skyltat', answer_type: 'checkbox' },
          { title: 'Bodar, toalett och förvaring på plats', answer_type: 'checkbox' },
          { title: 'El och vatten ordnat', answer_type: 'checkbox' },
          { title: 'Kunden informerad om start och kontaktperson', answer_type: 'checkbox' },
          { title: 'Befintligt skick dokumenterat', answer_type: 'checkbox', min_photos: 1 },
        ],
      ],
      [
        'Avetablering',
        [
          { title: 'Material, maskiner och avfall bortforslat', answer_type: 'checkbox' },
          { title: 'Avspärrningar borttagna', answer_type: 'checkbox' },
          { title: 'Området städat och återställt', answer_type: 'checkbox', min_photos: 1 },
          { title: 'Slutgenomgång med kund', answer_type: 'checkbox', required: false },
        ],
      ],
    ]),
  },
]
