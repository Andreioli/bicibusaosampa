# Design do Bici Busão Sampa

Como o visual do app é organizado, como mudar alguma coisa sem quebrar o resto e por
que escolhemos assim. Vale para quem desenha, para quem programa e para a IA que
trabalha no repositório: o CLAUDE.md aponta para cá.

O resumo: **toda cor, espaço, raio, estilo de texto, duração de animação e camada do app
é um token**. Os tokens ficam em JSON no
padrão [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/) do W3C, em
`design/tokens/`. Um script sem dependências gera deles o CSS e o JS que o site carrega.
O site continua sem build no deploy: os arquivos gerados são commitados, como os dados
em `public/data/`.

```
design/tokens/                 a fonte (você edita aqui)
  ref.tokens.json              a paleta
  ui.tokens.json               interface: espaço, tipo, raio, tamanho, camadas, sombras
  map.tokens.json              a simbologia do mapa e os rótulos da rota
  brand.tokens.json            cores do app fora da página (PWA)
  themes/light.tokens.json     cores da interface no modo claro, com descrições e metadados
  themes/dark.tokens.json      cores da interface no modo escuro, só valores
  motion/standard.tokens.json  durações de animação, com descrições e metadados
  motion/reduced.tokens.json   durações com "reduzir movimento" ligado, só valores
  bicibusao.resolver.json      como os arquivos se combinam (esquema de cor, movimento)
        │
        ▼  npm run build:tokens   (scripts/build-tokens.mjs)
        │
  public/tokens.css            variáveis CSS, com cada modo         (gerado)
  public/js/tokens.js          os mesmos valores para JavaScript   (gerado)
  DESIGN.md, tabelas abaixo    a lista de tokens deste documento   (gerado)

design/icons/                  os ícones da interface
  vocabulary.json              significado → desenho na biblioteca (você edita aqui)
  tabler/outline, tabler/filled  cópias dos SVGs, na versão que o vocabulário fixa
  tabler/LICENSE, source.json  a licença e de onde vieram as cópias
        │
        ▼  npm run build:icons    (scripts/build-icons.mjs)
        │
  public/js/icons.js           icon('swap') → <svg>                (gerado)
  public/index.html            os ícones da página, escritos no lugar (gerado)
```

## Como funciona

### Duas camadas: paleta e papéis

| Camada | Exemplo | O que é | Quem lê |
|---|---|---|---|
| **ref**, a paleta | `ref.color.green.600` | Os tons disponíveis. Valores puros, nunca apontam para outro token. | Só os papéis |
| **papéis** (`ui`, `map`, `brand`) | `map.bus.usual.ok` | Um trabalho para um valor: "ônibus em linha habitual, bici liberada". Sempre apontam para a paleta. | CSS, JS e HTML |

O código nunca usa a paleta direto. O verde do ônibus, o verde do bicicletário grátis e o
verde do trilho liberado são hoje o mesmo `green.600`, mas são três papéis diferentes. Se
um dia o bicicletário grátis mudar de cor, muda um papel e nada mais.

A paleta é a do [Tailwind](https://tailwindcss.com/docs/colors) (nomes e valores), sem o
Tailwind: uma escala que muita gente já conhece, com só os tons que o app usa.

Não temos uma terceira camada de tokens por componente (como `button.bg`). Com meia
dúzia de componentes, os papéis bastam.

### Os três domínios

- **`ui`**: a interface (painéis, botões, campos, textos). Muda entre claro e escuro.
- **`map`**: a simbologia do mapa. Cada cor responde a uma pergunta de quem pedala
  ("posso levar a bici agora?", "posso deixar a bici aqui?"), e o significado vem antes
  do tom. **Não muda no modo escuro**: o mapa tem que ler igual de dia e de noite.
- **`brand`**: o app fora da página: a cor da barra do navegador e a tela de abertura.

As cores oficiais das linhas de metrô e trem **não são tokens**. São dados das
operadoras e ficam em `public/data/rail-lines.json`.

### Nomes

`<domínio>.<papel>[.<variante>][.<parte>]`, em minúsculas, com pontos entre os níveis e
hífen dentro das palavras. Exemplos: `ui.content.secondary`, `map.bus.offroute.wait`,
`map.plan.pin.from`. O nome vira:

- variável CSS: os pontos viram hífens → `--map-bus-offroute-wait`
- chave em JavaScript: camelCase → `tokens.map.bus.offroute.wait`, `tokens.map.plan.busBike`

Na paleta: `ref.color.<matiz>.<passo>` (`ref.color.stone.900`). Translúcidas ficam em
`ref.color.alpha.<cor>-<opacidade>` (`ref.color.alpha.black-18`). As escalas são nomeadas
pelo valor: `ref.space.12` = 12 px, `ref.radius.9999`, `ref.duration.200` = 200 ms,
`ref.font.size.14`.

### As escalas

Tudo cai numa **grade de 4 px**, com 2 px como única exceção (para encostar coisas
pequenas). O teste recusa um espaço ou tamanho fora dela. A paleta só tem os passos que
algum papel usa; zero não é token (`0` vale direto no CSS).

| Escala | Paleta (`ref`) | Papéis |
|---|---|---|
| Espaço | 2, 4, 8, 12, 16, 24 | `ui.space.inset.*` (por dentro: padding) e `ui.space.gap.*` (entre coisas: gap e margin), de `2xs` a `xl`, com os mesmos passos; `ui.space.edge` (distância até a borda da tela) |
| Texto | tamanhos 10–18, alturas de linha, pesos, espaçamento entre letras | `ui.type.*`: `title`, `heading`, `body` (16 px), `body-sm`, `label`, `caption`, `overline`; `ui.font.weight.*`; `map.label.*` para o texto sobre o mapa |
| Raio | 4, 8, 12, 16, 9999 | `ui.radius.small`, `item`, `control`, `container`, `full` |
| Tamanho | 4, 16–44, 280, 360 | `ui.size.touch` (44), `ui.size.icon.*`, `ui.size.control.*`, `ui.size.pin`, `ui.size.panel.*` |
| Movimento | durações 0–1000 ms, curvas | `ui.motion.duration.fast/base/slow/loop`, `ui.motion.easing.*` |
| Camadas | — | `ui.layer.sheet`, `map-controls`, `toast`, `banner` |

Um estilo de texto (`ui.type.*`) é um token composto (`$type: typography`): tamanho, altura
de linha, peso, família e espaçamento entre letras juntos. No CSS ele vira duas variáveis,
porque `letter-spacing` não cabe no atalho `font`:

```css
h2 {
  font: var(--ui-type-overline);
  letter-spacing: var(--ui-type-overline-tracking);
}
```

`font` redefine tudo o que é de fonte. Um `font-variant-numeric` ou `font-weight` que
complete o estilo vem **depois** dele.

O texto do mapa tem escala própria (`map.label.*`). Ele é desenhado sobre linhas e lido
de relance, e o JS lê esses tamanhos para encolher cada rótulo até caber no trecho.

### Modos: claro e escuro, movimento reduzido

O `bicibusao.resolver.json` segue o
[Resolver](https://www.designtokens.org/tr/2025.10/resolver/) da spec. Ele junta os
arquivos base e escolhe um contexto de cada modificador:

| Modificador | Contextos | No CSS |
|---|---|---|
| `scheme` | `light` (padrão), `dark` | `@media (prefers-color-scheme: dark)` |
| `motion` | `standard` (padrão), `reduced` | `@media (prefers-reduced-motion: reduce)`: as durações vão a 0 |

Cada token de um modificador existe em todos os contextos, com o mesmo nome. A descrição e
os metadados ficam só no contexto padrão, para não divergirem, e o teste recusa um token
que exista num arquivo e falte no outro. Um token muda com um modificador só.

No CSS gerado, cada contexto que não é o padrão vira um bloco `@media` com só os tokens que
mudam. Como as durações vêm de token, quem pede "reduzir movimento" no aparelho deixa de
ver todas as transições, não só as que alguém lembrou de tratar.

### Metadados

Cada papel tem uma descrição (`$description`) que diz **para que serve**, nas palavras de
quem vai escolher: "Texto de apoio: títulos de seção, horários, detalhes". Não diz o
valor nem a camada, que o nome e o arquivo já dizem.

O resto fica em `$extensions["info.bicisampa"]`, um espaço de nomes nosso, que outras
ferramentas DTCG ignoram sem erro:

| Campo | Para quê |
|---|---|
| `usage` | Onde usar, de uma lista fixa: `text`, `icon`, `background`, `border`, `outline`, `line`, `fill`, `shadow`, `text-shadow`, `font`, `theme-color`, `padding`, `gap`, `margin`, `position`, `width`, `height`, `radius`, `z-index`, `transition`, `animation`. O teste recusa outro termo. |
| `avoid` | Onde não usar, em frases curtas em português. |
| `contrast` | Pares que precisam de contraste mínimo: `[{ "against": "ui.surface.page", "min": 4.5 }]`. O teste mede cada par nos dois esquemas. |
| `departure` | Dentro de um par de `contrast`: uma exceção conhecida, com `rule`, `reason` e `since`. Veja "Quando o contraste falha". |

Esses dados servem a gente e servem a máquina: uma IA que abre `map.tokens.json` sabe para
que é cada cor, onde não usar e com o que precisa contrastar, sem adivinhar.

### Ícones

A interface usa o [Tabler Icons](https://tabler.io/icons) (licença MIT), em dois estilos:
**contorno** em repouso e **preenchido** no que está ligado ou escolhido (o modo e a
prioridade do planejador, o botão de camadas aberto) e sobre o mapa. O código pede um
**significado**, nunca o nome na biblioteca:

```js
import { icon } from './icons.js';
button.innerHTML = `${icon('swap', 'icon-sm')} Inverter`;
marker.innerHTML = icon('parking', 'icon-sm', 'filled');
```

No `index.html`: `<i data-icon="swap" class="icon-sm"></i>` (ou com `data-style="filled"`),
que o build troca pelo `<svg>` ali mesmo, então o ícone aparece antes de qualquer script
rodar. Um controle que liga e desliga leva os dois estilos dentro de
`<span class="icon-swap">`, e o CSS mostra o preenchido quando ele está marcado
(`:checked`, `aria-pressed="true"`).

O vocabulário (`design/icons/vocabulary.json`) diz o que cada ícone significa, onde se usa
e qual desenho o representa em cada estilo (`name` para contorno, `filled` quando existe).
Ele não depende da biblioteca: trocar o desenho de um significado é mudar uma linha;
trocar de biblioteca é mudar `library`, `version` e os nomes, e ensinar ao
`scripts/fetch-icons.mjs` onde ela publica os SVGs. Nenhum `icon('…')` do app muda.

Lacuna conhecida: o Tabler não tem metrô, então `metro` usa o mesmo desenho de `train`.

O tamanho vem do CSS, pela escala `ui.size.icon.*`: `.icon` (20 px), `.icon-sm` (16 px),
`.icon-lg` (24 px). A cor é a do texto (`currentColor`).

**No mapa, a forma que é informação continua nossa.** O ônibus ao vivo com a seta (o
sentido), a casinha e o círculo do bicicletário (o tipo) e os logos oficiais das estações
(Metrô e CPTM) são desenhados em `app.js`. O que não carrega dado na forma (o ponto de
ônibus, os ícones ao longo do trajeto) passa a usar o preenchido do vocabulário dentro de
um selo nosso com halo, para ler sobre as linhas: **[meta]**, no redesign.

**Sem emoji nem glifo de texto como ícone** (☰, ▾, ✕…): eles mudam de cara em cada
aparelho e não seguem a cor do texto. Setas dentro de frases ("A → B") e © são texto e
continuam.

## Tarefas comuns

### Mudar uma cor

1. Ache o papel nas tabelas abaixo, ou em `design/tokens/`.
2. Aponte o papel para outro tom da paleta (`"$value": "{ref.color.blue.600}"`). Se o tom
   não existir, acrescente-o em `ref.tokens.json`, com o valor do Tailwind.
3. Rode `npm run build:tokens` e depois `npm test`.
4. Commite a fonte e os gerados juntos.

O build reescreve sozinho `public/tokens.css`, `public/js/tokens.js`, as tabelas deste
documento e as cores repetidas em `index.html` (`theme-color`) e no manifesto. Não edite
nenhum deles à mão: o teste falha se não baterem com a fonte.

### Acrescentar um ícone

1. Procure o desenho em [tabler.io/icons](https://tabler.io/icons), nos estilos
   *outline* e, se houver, *filled*.
2. Acrescente o significado em `design/icons/vocabulary.json`: `name` (contorno), `filled`
   (se existir) e uma descrição de quando usar. Antes, veja se um significado existente
   já serve.
3. `npm run icons:fetch` copia os SVGs para `design/icons/tabler/` (precisa de internet; é
   a única etapa que precisa).
4. `npm run build:icons`, depois `npm test`. Commite as cópias e os gerados.

Para atualizar o Tabler, mude `version` no vocabulário e rode os mesmos dois comandos.

### Criar um token

Crie quando houver um trabalho novo, não um valor novo. Antes, veja se um papel existente
já faz esse trabalho. Um token novo precisa de `$value` apontando para a paleta, de
`$description`, de `usage` e, se for texto ou símbolo sobre uma cor, de `contrast`.

### Usar um token

| Onde | Como |
|---|---|
| CSS | `color: var(--ui-content-secondary);` · `padding: var(--ui-space-inset-sm) var(--ui-space-inset-md);` · `font: var(--ui-type-label);` · `transition: opacity var(--ui-motion-duration-base) var(--ui-motion-easing-standard);` · negativo: `calc(var(--ui-space-gap-xs) * -1)` |
| HTML gerado em JS (popups) | Classes do `style.css` (`<p class="meta">`). Estilo inline só para o que é calculado na hora: a cor de uma linha, um tamanho que depende do zoom. |
| SVG gerado em JS, Leaflet, canvas | `import { tokens } from './tokens.js'` → `fill="${tokens.map.icon.ink}"`. Um nome errado (`tokens.map.icon.inkk`) faz o teste falhar. |
| SVG no HTML | `style="fill: var(--map-compass-north)"`, como no CSS |
| `index.html` `theme-color`, `manifest.webmanifest` | Esses arquivos não leem CSS: o build escreve neles o valor de `brand.*`. |

O canvas do Leaflet (trilhos e itinerários) não entende `var()`. Por isso o JS recebe os
valores já resolvidos em `tokens.js`. Um token que muda com o esquema vira
`{ light, dark }` no JS. Só `ui.*` pode mudar: o build recusa um `map.*`, `brand.*` ou
`ref.*` com valor diferente no escuro, para o mapa nunca receber um objeto no lugar de
uma cor.

### Quando o contraste falha

O teste mede cada par de `contrast` (WCAG 2.x; uma cor translúcida é composta sobre o
fundo do par, e o fundo sobre `ui.surface.page`). Os painéis e o toast ficam, na
verdade, sobre o mapa; com 97% e 94% de opacidade a diferença é pequena, mas existe.
4,5:1 para texto e 3:1 para símbolos. Se um par não passa, há duas saídas:

- **Corrigir**: trocar o tom até passar.
- **Registrar uma exceção**: acrescentar `departure` ao par, dizendo o porquê e desde
  quando. É uma decisão consciente, não um esquecimento.

O teste também falha quando uma exceção **deixa de ser necessária**: se o par passou a ter
contraste, a exceção tem que sair. Assim a lista de exceções nunca mente.

As exceções de hoje estão marcadas com ⚠️ nas tabelas abaixo.

## Regras

Cada regra tem uma marca: **[automática]** quer dizer que `npm test` recusa quem a quebra.
**[revisão]** depende de quem revisa, pessoa ou IA. **[meta]** é regra adotada que o
código ainda não segue.

### Tokens

- Toda cor do app vem de um token. Em `style.css`, `index.html`, `sw-template.js` e
  `public/js/`, o teste recusa `#hex`, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`,
  `oklab()`, `oklch()` e `color()`, e, no CSS, nomes de cor como `white`.
  **[automática]**
- Em `style.css`, `padding`, `margin`, `gap`, `border-radius`, `font`, `font-size`,
  `font-weight`, `line-height`, `letter-spacing`, `transition`, `animation` e `z-index`
  só aceitam tokens (`0`, porcentagens e palavras como `auto` estão liberados).
  **[automática]**
- Espaço e tamanho da paleta ficam na grade de 4 px, com 2 px como exceção. **[automática]**
- Estilo inline no HTML gerado pelo JS só para `background`, `width`, `height`,
  `transform` e `fill`: valores calculados na hora. O resto é classe. **[automática]**
- Sombras vêm de tokens. **[revisão]**: o teste não reconhece uma sombra escrita à mão.
- A paleta (`ref`) nunca aponta para outro token, e só guarda o que algum papel usa.
  **[automática]**
- Um papel aponta para a paleta, nunca para um valor cru. As exceções estão declaradas no
  teste, cada uma com o motivo (hoje: os comprimentos das sombras, cuja cor vem da paleta,
  e as camadas, que conversam com números do Leaflet). Uma exceção que deixa de ser usada
  também faz o teste falhar. **[automática]**
- O código nunca lê a paleta (`var(--ref-…)`), nunca lê uma variável CSS que não existe e
  nunca lê em JS um token que não existe. **[automática]**
- Dois tokens não podem gerar o mesmo nome (`map.plan.bus-bike` e `map.plan.bus.bike`
  viram ambos `--map-plan-bus-bike`): o build recusa. **[automática]**
- Todo papel tem `$description` e `usage`, e `usage` só usa os termos da lista.
  **[automática]**
- Os arquivos gerados batem com a fonte. **[automática]**
- `theme-color` e o manifesto batem com `brand.*` (o build os escreve). **[automática]**
- Todo par de `contrast` passa nos dois esquemas, ou tem uma exceção registrada que ainda
  é necessária. **[automática]**
- Um token novo nasce de um trabalho novo, não de um valor novo. Dois papéis que hoje têm
  o mesmo tom continuam separados se significam coisas diferentes. **[revisão]**
- Os arquivos em `design/tokens/` usam só o formato DTCG padrão; o que é nosso fica em
  `$extensions["info.bicisampa"]`. **[revisão]**
- Larguras e alturas de peças pequenas (amostras da legenda, a alça da folha), larguras
  de borda e de traço também viram tokens. **[meta]**: hoje só os tamanhos com papel
  (área de toque, ícones, controles, painéis) são tokens.

### Ícones

- Todo ícone usado está no vocabulário, e todo ícone do vocabulário é usado.
  **[automática]**
- As cópias em `design/icons/<biblioteca>/` são exatamente as do vocabulário, nos dois
  estilos, da biblioteca e versão dele (`source.json`), com a licença; não sobra cópia de
  outra biblioteca. Um ícone usado preenchido precisa ter `filled` no vocabulário.
  **[automática]**
- `icons.js` e os ícones do `index.html` batem com o vocabulário. **[automática]**
- Nenhum emoji ou glifo de texto como ícone em `index.html`, `style.css` e `public/js/`.
  **[automática]**
- Ícone ao lado de texto não precisa de nome; botão só com ícone precisa de `aria-label`.
  **[revisão]**

### Mapa

- O status nunca depende só da cor: tracejado = fora do horário da bici, pontilhado =
  fechado, barra diagonal = bicicletário fechado. **[revisão]**
- Nada de `filter` ou `box-shadow` borrado em ícones do mapa: no celular cada um é
  repintado a cada quadro. Use contornos desenhados no SVG (`map.icon.ink`). **[revisão]**
- Área de toque de pelo menos 44 px nos controles (`ui.size.touch`) e de 32 a 40 px
  nos ícones do mapa. **[revisão]**

## Tokens

As tabelas abaixo são geradas por `npm run build:tokens` a partir de `design/tokens/`.
Não edite à mão: o teste confere.

### Interface (`ui`)

<!-- tokens:ui -->
| Token | Valor | Para quê |
|---|---|---|
| `ui.content.on-color` | `#ffffff` | Texto e símbolos sobre fundo colorido: badges de linha, pins, toast. ⚠️ contraste com `map.bus.usual.ok` abaixo de 4.5:1; contraste com `map.bus.usual.wait` abaixo de 4.5:1; contraste com `map.bus.offroute.wait` abaixo de 4.5:1. |
| `ui.toast.surface` | `rgb(20 24 30 / 0.94)` | Fundo do toast ("Origem marcada no mapa · Desfazer"). |
| `ui.outline.subtle` | `rgb(0 0 0 / 0.15)` | Aro das bolinhas de status na legenda e nas listas. |
| `ui.shadow.raised` | `0px 4px 24px rgb(0 0 0 / 0.18)` | Painéis e botões flutuando sobre o mapa. Nunca em ícones do mapa: no celular cada sombra é repintada a cada quadro. |
| `ui.shadow.overlay` | `0px 6px 24px rgb(0 0 0 / 0.35)` | O que pede atenção acima de tudo: o aviso de nova versão. |
| `ui.shadow.pin` | `0px 1px 3px rgb(0 0 0 / 0.45)` | Pins A/B/parada e o marcador de troca de modo. São poucos na tela, então a sombra não pesa. |
| `ui.shadow.text-on-color` | `0px 0px 2px rgb(0 0 0 / 0.5)` | Sombra do texto dos badges de linha, para o branco ler sobre o amarelo e o laranja. |
| `ui.font.family.base` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Fonte do sistema: zero download, e o texto fica com a cara do celular de quem usa. |
| `ui.font.weight.regular` | `400` | Texto corrido. |
| `ui.font.weight.strong` | `600` | Destaque dentro do texto: nomes de linha, rótulos, a opção escolhida. |
| `ui.font.weight.bold` | `700` | Títulos, badges e o que precisa saltar. |
| `ui.size.touch` | `44px` | Lado mínimo de tudo que se toca (Apple HIG: 44 pt). |
| `ui.size.control.md` | `40px` | Altura dos botões de zoom do mapa. |
| `ui.size.control.sm` | `36px` | Botões secundários em pílula (Compartilhar, Desfazer): menores que a área de toque, mas sempre dentro de uma linha que tem 44 px. |
| `ui.size.icon.sm` | `16px` | Ícones dentro de texto e listas. |
| `ui.size.icon.md` | `20px` | Ícones de botão. |
| `ui.size.icon.lg` | `24px` | Ícones de destaque, pins da lista e caixas de seleção. |
| `ui.size.pin` | `32px` | Pins A/B/parada sobre o mapa. |
| `ui.size.panel.md` | `360px` | Largura do menu em telas largas. |
| `ui.size.panel.sm` | `280px` | Largura da folha de camadas em telas largas. |
| `ui.size.grip` | `4px` | Espessura da alça de arrastar da folha no celular. |
| `ui.space.inset.2xs` | `2px` | Espaço interno 2xs. |
| `ui.space.inset.xs` | `4px` | Espaço interno xs. |
| `ui.space.inset.sm` | `8px` | Espaço interno sm. |
| `ui.space.inset.md` | `12px` | Espaço interno md. |
| `ui.space.inset.lg` | `16px` | Espaço interno lg. |
| `ui.space.inset.xl` | `24px` | Espaço interno xl. |
| `ui.space.gap.2xs` | `2px` | Espaço entre itens 2xs. |
| `ui.space.gap.xs` | `4px` | Espaço entre itens xs. |
| `ui.space.gap.sm` | `8px` | Espaço entre itens sm. |
| `ui.space.gap.md` | `12px` | Espaço entre itens md. |
| `ui.space.gap.lg` | `16px` | Espaço entre itens lg. |
| `ui.space.gap.xl` | `24px` | Espaço entre itens xl. |
| `ui.space.edge` | `12px` | Distância dos controles e painéis até a borda da tela (somada à área segura do aparelho). |
| `ui.radius.small` | `4px` | Peças pequenas: badges de linha, amostras da legenda, ícones de estação. |
| `ui.radius.item` | `8px` | Linhas de lista selecionáveis e a opção de rota escolhida. |
| `ui.radius.control` | `12px` | Botões, campos e os botões sobre o mapa. |
| `ui.radius.container` | `16px` | Painéis e folhas. |
| `ui.radius.full` | `9999px` | Pílulas e círculos (pins, bolinhas de status, toast). |
| `ui.type.title` | `700 18px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | O nome do app no topo do menu. |
| `ui.type.heading` | `700 16px/1.25 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Títulos de popup e de trecho da rota. |
| `ui.type.body` | `400 16px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Texto corrido e campos (16 px: o iPhone não dá zoom ao tocar no campo). |
| `ui.type.body-sm` | `400 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Texto de apoio: detalhes, notas, conteúdo dos popups. |
| `ui.type.label` | `600 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Botões, opções e rótulos curtos. |
| `ui.type.caption` | `400 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Créditos, fonte dos dados, legendas miúdas. |
| `ui.type.overline` | `600 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Títulos de seção, em caixa alta. |
| `ui.layer.sheet` | `1000` | Menu e folha de camadas. |
| `ui.layer.map-controls` | `1001` | Botões sobre o mapa, acima das folhas. |
| `ui.layer.toast` | `1200` | O toast. |
| `ui.layer.banner` | `1201` | O aviso de nova versão, acima de tudo. |
| `ui.motion.easing.standard` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Quase todas as transições. |
| `ui.motion.easing.linear` | `cubic-bezier(0, 0, 1, 1)` | Movimento que acompanha um gesto contínuo. |
| `ui.motion.easing.pulse` | `cubic-bezier(0.42, 0, 0.58, 1)` | Animações em loop, que vão e voltam. |
| `ui.surface.page` | `#ffffff` · dark `#0c0a09` | Fundo da página e dos campos. |
| `ui.surface.panel` | `rgb(255 255 255 / 0.97)` · dark `rgb(28 25 23 / 0.97)` | Painéis e botões sobre o mapa; quase opaco, para o mapa aparecer de leve por trás. |
| `ui.content.primary` | `#1c1917` · dark `#f5f5f4` | Texto principal. |
| `ui.content.secondary` | `#57534e` · dark `#a8a29e` | Texto de apoio: títulos de seção, horários, detalhes. |
| `ui.border.default` | `#e7e5e4` · dark `#292524` | Bordas de painéis, campos e separadores de lista. |
| `ui.accent.default` | `#0f766e` · dark `#2dd4bf` | Ação e seleção: botão ativo, foco, links, opção escolhida. |
| `ui.accent.on` | `#ffffff` · dark `#042f2e` | Texto sobre o destaque. |
| `ui.motion.duration.fast` | `100ms` · reduced `0ms` | Seguir um gesto (a bússola girando com o mapa). |
| `ui.motion.duration.base` | `200ms` · reduced `0ms` | Aparecer e sumir: toast, rótulos, camadas esmaecendo. |
| `ui.motion.duration.slow` | `400ms` · reduced `0ms` | Deslocar no mapa (o ônibus virando para o sentido da viagem). |
| `ui.motion.duration.loop` | `1000ms` · reduced `0ms` | Ciclo de uma animação contínua (o botão de localização piscando enquanto procura). |
<!-- /tokens:ui -->

### Mapa (`map`)

<!-- tokens:map -->
| Token | Valor | Para quê |
|---|---|---|
| `map.status.ok` | `#16a34a` | Bici liberada agora. |
| `map.status.wait` | `#eab308` | A linha opera, mas está fora do horário da bici. Sempre com tracejado, para não depender só da cor. |
| `map.status.closed` | `#dc2626` | Linha fechada ou paralisada. Sempre com pontilhado. |
| `map.bus.usual.ok` | `#16a34a` | Linha habitual, bici liberada. |
| `map.bus.usual.wait` | `#eab308` | Linha habitual, fora do horário da bici. Contorno tracejado. |
| `map.bus.offroute.ok` | `#9333ea` | Superarticulado fora das linhas habituais, bici liberada. |
| `map.bus.offroute.wait` | `#f97316` | Fora das linhas habituais e fora do horário da bici. Contorno tracejado. |
| `map.bus.emtu` | `#0e7490` | Seletivo EMTU (bici no bagageiro). Uma cor só, a qualquer hora: a EMTU não publica regra. Cantos retos no ícone. |
| `map.parking.free` | `#16a34a` | Livre: gratuito, sem cadastro. |
| `map.parking.signup` | `#2563eb` | Gratuito com cadastro no local (estações e terminais). |
| `map.parking.paid` | `#db2777` | Pago. |
| `map.parking.customers` | `#78716c` | Só clientes ou autorizados. |
| `map.parking.closed` | `#dc2626` | Fechado agora, pelo horário do OpenStreetMap. Vence as outras cores e ganha uma barra diagonal. |
| `map.icon.ink` | `#1c1917` | Contorno escuro dos ícones do mapa. Destaca o verde de um bicicletário sobre o verde de um itinerário, sem sombra (que pesa no celular). |
| `map.icon.on` | `#ffffff` | Símbolos e halos brancos: seta do ônibus, suporte do paraciclo, contorno das estações, texto dos rótulos da rota. ⚠️ contraste com `map.bus.usual.wait` abaixo de 3:1; contraste com `map.bus.offroute.wait` abaixo de 3:1. |
| `map.stop.body` | `#1c1917` | Ícone de ponto de ônibus (ônibus de frente). |
| `map.stop.lights` | `#fde68a` | Faróis do ícone de ponto. |
| `map.location.accent` | `#2563eb` | Bolinha azul de "você está aqui" e o círculo de precisão. |
| `map.compass.north` | `#dc2626` | Ponta norte da bússola. |
| `map.plan.walk` | `#57534e` | A pé. |
| `map.plan.bike` | `#dc2626` | Pedalando. |
| `map.plan.bus-bike` | `#16a34a` | Ônibus com a bici a bordo. |
| `map.plan.bus` | `#1c1917` | Ônibus sem a bici (ela ficou num bicicletário). |
| `map.plan.emtu` | `#0e7490` | Seletivo EMTU, bici no bagageiro. |
| `map.plan.casing` | `#ffffff` | Faixa branca por baixo do trajeto, para ele saltar sobre o mapa. |
| `map.plan.total` | `#1c1917` | Contorno do rótulo "Total" da viagem. |
| `map.plan.transfer` | `#1c1917` | Marcador ⇄ de troca de modo. |
| `map.plan.pin.from` | `#0f766e` | Pin A (origem). |
| `map.plan.pin.via` | `#57534e` | Pins de parada. |
| `map.plan.pin.to` | `#b91c1c` | Pin B (destino). |
| `map.label.size.leg` | `12px` | Tempo, kcal e distância de um trecho. |
| `map.label.size.line` | `14px` | Código da linha num trecho de ônibus ou trem. |
| `map.label.size.total` | `14px` | O rótulo "Total" da viagem. |
| `map.label.weight.leg` | `600` | Rótulos de trecho. |
| `map.label.weight.strong` | `800` | Código da linha e o total: precisam ler mesmo pequenos. |
| `map.label.tracking.leg` | `0.5px` | Letras um pouco abertas: o contorno grosso fecha o espaço entre elas. |
| `map.label.badge` | `700 10px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Número 1, 2… nos ícones de trecho quando há mais de uma condução do mesmo tipo. |
<!-- /tokens:map -->

### App (`brand`)

<!-- tokens:brand -->
| Token | Valor | Para quê |
|---|---|---|
| `brand.theme` | `#0f766e` | theme-color: barra do navegador e do app instalado. |
| `brand.splash` | `#3d2b1f` | Fundo da tela de abertura e do ícone maskable. |
<!-- /tokens:brand -->

## Decisões

Cada decisão tem o contexto, o que escolhemos, o que ficou de fora e quando vale
revisitar. Decisões novas entram no fim.

### 1. Tokens em DTCG como fonte (2026-11-03)

**Contexto.** Hoje o Bici Busão é um webapp, mas o plano é ter apps Android e iOS. A stack
ainda não foi decidida: pode ser o próprio site empacotado (Capacitor) ou apps nativos.

**Decisão.** A fonte dos tokens é JSON no padrão DTCG 2025.10, a primeira versão estável
da spec do W3C (out/2025). Os arquivos que o site usa são gerados a partir dela.

**Por quê.** O risco não é igual nos dois cenários. Se os apps reusarem o site, o DTCG
custa um comando a mais. Se forem nativos, ter começado com CSS obrigaria a reconstruir os
tokens, e principalmente o *significado* de cada cor, a partir de CSS e comentários, com o
app já em andamento. No DTCG o significado fica junto do valor e chega a qualquer
plataforma.

**Fora.** CSS como fonte única: mais simples hoje, mas fecha a porta para o nativo.

**Revisitar** quando a stack dos apps for decidida.

### 2. Um script nosso, não o Style Dictionary (2026-11-03)

**Contexto.** O Style Dictionary é a ferramenta mais usada para gerar tokens. Num teste
com a versão 5.7.1, ele leu bem as cores e dimensões do formato 2025.10, mas **não lê o
Resolver**, que é a parte da spec que define claro e escuro. Teríamos que rodar o
Style Dictionary duas vezes e escrever à mão o código que junta os resultados: a parte
difícil ficaria conosco de qualquer jeito. Ele traz ainda 82 pacotes (60 MB).

**Decisão.** `scripts/build-tokens.mjs`: pouco mais de 200 linhas, sem dependências, que lê o
resolver e escreve CSS, JS e as tabelas deste documento.

**Por quê.** O projeto valoriza poucas dependências. O escopo é pequeno e estável (CSS e
JS, um modo claro/escuro). E o script é **descartável**: como a fonte é DTCG padrão, ele
pode dar lugar a uma ferramenta pronta sem que ninguém reescreva um token.

**Não é por performance.** Para quem usa o app não muda nada: o gerador roda no
computador de quem desenvolve, e o site recebe os mesmos arquivos estáticos nos dois casos.

**O cuidado.** O script cobre só o que usamos da spec (resolver com um modificador,
aliases, cores sRGB, dimensões, sombras e famílias de fonte) e para com erro diante do que
não conhece. A fonte não pode ganhar formato inventado: se um dia precisar, a resposta é
outra ferramenta, não um dialeto.

**Revisitar** quando houver saída para Android ou iOS (o Style Dictionary já tem formatos
prontos para as duas plataformas), ou se ele passar a ler o Resolver.

### 3. Claro e escuro em arquivos de tema, pelo Resolver (2026-11-03)

**Contexto.** Há duas formas de declarar modos: cada token carrega suas variações numa
extensão própria, ou cada modo é um arquivo combinado pelo Resolver da spec. A primeira
deixa tudo junto, mas é um formato só nosso. A segunda é o padrão, mas espalha um token
por dois arquivos.

**Decisão.** Resolver, com `themes/light` e `themes/dark`. Descrição e metadados ficam só
no claro, e o teste recusa um token que exista num arquivo e falte no outro.

**Por quê.** É o formato da spec: uma ferramenta que implemente o Resolver lê esses
arquivos sem adaptação, e uma extensão nossa ela ignoraria. O risco de esquecer um lado
vira erro de teste, não uma diferença silenciosa.

### 4. `@media` no CSS gerado, não `light-dark()` (2026-11-03)

**Contexto.** `light-dark()` declararia cada token uma vez só, mas só funciona no Safari a
partir do iOS 17.5, e iPhones como o 8 e o X param no iOS 16. Hoje, o que o app usa de
mais novo (`color-mix()`, iOS 16.2) só aparece em detalhes: o fundo de um item
selecionado. Quando falha, some um detalhe. Com `light-dark()` nos tokens, num iPhone
desses o app ficaria sem nenhuma cor de interface.

**Decisão.** O gerador escreve `:root { … }` com o claro e um
`@media (prefers-color-scheme: dark)` com o que muda.

**Revisitar** quando o iOS 16 deixar de importar. Como o CSS é gerado, a troca fica no
script, sem tocar nos tokens.

### 5. Sem `@layer`, por enquanto (2026-11-03)

**Contexto.** Camadas de cascata deixariam explícita a ordem entre o CSS do Leaflet e o
nosso. Mas estilos fora de camada vencem os de dentro: com o `style.css` em camadas e o
Leaflet (do CDN) fora, os nossos overrides do Leaflet perderiam.

**Decisão.** Nada em camadas nesta etapa. Reorganizar o `style.css` em camadas, pondo o
Leaflet numa delas (`@import … layer(leaflet)`), é trabalho do redesign, com conferência
visual.

### 6. A simbologia do mapa não muda no modo escuro (2026-11-03)

O mapa tem que ler igual de dia e de noite, e o significado das cores não depende do
tema. Só a interface (`ui`) tem tema. Os tokens `map.*` ficam fora de `themes/`.

### 7. Cores translúcidas são primitivas (2026-11-03)

O DTCG não tem como dizer "este tom com 18% de opacidade" num alias. Cada cor translúcida
que usamos é uma primitiva em `ref.color.alpha`, e os papéis apontam para ela como para
qualquer outra.

### 8. Primeira etapa: cor, sombra, fonte e área de toque (2026-11-03)

**Decisão.** Viraram tokens os valores que já tinham significado claro. Espaçamento,
raios e tamanhos de texto ficaram de fora.

**Por quê.** O CSS de hoje tem esses valores soltos (10, 12, 12,5, 13, 13,5, 14 px…).
Transformá-los em tokens sem mudar nada criaria uma "escala" que só repete o acaso. Uma
escala de verdade muda valores, e isso é redesign.

A primeira etapa foi comparada pixel a pixel com o site anterior em 8 telas (claro e
escuro, desktop e celular, com e sem rota): diferença zero, fora alguns pixels de
anti-aliasing nos cantos arredondados. Uma mudança não aparece nos testes: o número do
trajeto (`.plan-trail sub`) usava `system-ui, sans-serif` e agora usa a fonte base
completa. Só muda num navegador sem `system-ui`.

### 9. Exceções de contraste registradas, não escondidas (2026-11-03)

Ao medir os pares, três problemas que já existiam apareceram:

- a seta branca do ônibus amarelo tem 1,92:1 e a do laranja, 2,80:1 (o mínimo para
  símbolo é 3:1);
- o texto branco dos badges de linha sobre verde, amarelo e laranja fica abaixo de 4,5:1.

Nenhum foi corrigido nesta etapa, porque corrigir muda o visual e as cores são decisões do
mantenedor. Ficaram registrados como `departure` nos tokens, com o motivo, e o teste vai
avisar quando deixarem de ser necessários.

### 10. Grade de 4 px, com 2 px de exceção (2026-11-03)

**Contexto.** O CSS tinha 13 espaçamentos diferentes (1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 14,
16, 18 e 32 px), 10 raios e 11 tamanhos de texto: o acaso de muitas iterações rápidas.

**Decisão.** Espaço e tamanho numa grade de 4 px; 2 px é a única exceção, para encostar
peças pequenas. Na migração, o **padding arredondou para cima** (6 → 8, 10 → 12, 14 → 16),
para não encolher área de toque, e o **espaço entre coisas arredondou para baixo** (6 → 4,
10 → 8, 14 → 12), para não espalhar listas no celular.

**Por quê.** Com poucos passos, duas pessoas (ou uma IA) escolhem o mesmo valor sem
combinar, e o olho lê ritmo onde antes lia ruído. Uma grade é também o que os sistemas
de Android e iOS já usam (dp e pt em múltiplos de 4), então a escala viaja para os apps.

### 11. Texto base de 16 px (2026-11-03)

**Decisão.** `ui.type.body` passou de 15 para 16 px, e o texto de apoio de 13 para 14.

**Por quê.** Os campos já precisavam de 16 px para o iPhone não dar zoom ao tocar neles;
agora o texto corrido acompanha. O app é usado na rua, muitas vezes no sol e em
movimento: um ponto a mais pesa a favor da leitura. A escala ficou em passos de 2 px
(10, 12, 14, 16, 18).

### 12. Estilos de texto compostos, e uma escala só para o mapa (2026-11-03)

**Decisão.** Cada estilo de texto é um token `typography` (tamanho, altura, peso, família,
espaçamento juntos). No CSS, `font: var(--ui-type-x)` mais `letter-spacing` à parte. O
texto sobre o mapa tem tokens próprios em `map.label.*`.

**Por quê.** Tamanho e peso soltos se recombinam ao acaso (um 13 px em negrito aqui, um
14 px seminegrito ali). Um estilo composto é uma escolha só. Os rótulos do mapa respondem a
outra coisa: são desenhados sobre linhas, com contorno grosso, e o JS encolhe cada um até
caber no trecho, lendo o tamanho do token.

**Fora.** Gerar classes CSS por estilo (`.type-body`). Seria um segundo jeito de aplicar a
mesma coisa; uma variável no `font` basta.

### 13. Movimento reduzido como modo do token (2026-11-03)

**Contexto.** Antes, só a animação do botão de localização respeitava "reduzir
movimento", com um `@media` escrito à mão. As transições (fades, a seta do ônibus
virando) não.

**Decisão.** As durações são tokens com um segundo modificador no resolver, `motion`:
no contexto `reduced` elas vão a 0, e o CSS gerado as troca com
`@media (prefers-reduced-motion: reduce)`.

**Por quê.** Acessibilidade de graça para toda transição nova, sem ninguém lembrar.

### 14. Sem modos de densidade nem de tamanho de tela (2026-11-03)

O Raw DS, em que este método se inspira, tem modos de densidade (compacto, confortável) e
de viewport. Aqui não: o app tem uma densidade e um layout de celular que vira cartão em
tela larga. Os modos seriam peso sem uso. Se um dia um tablet pedir outro ritmo, o
resolver ganha um modificador, como `motion`.

### 15. Popups com classes, não estilo inline (2026-11-03)

Os popups eram montados com `style="margin:6px 0 0"` em 23 lugares do `app.js`, fora do
alcance dos tokens. Viraram classes (`.leaflet-popup-content p`, `.meta`, `.source`…), e
o teste só deixa inline o que é calculado na hora. Os popups passaram a usar a fonte do
sistema, como o resto do app (antes herdavam a Helvetica do CSS do Leaflet).

### 16. Ícones do Tabler, por significado, em contorno e preenchido (2026-11-03)

**Decisão.** A interface usa o Tabler Icons (MIT, 3.49.0), com um vocabulário por
significado (`icon('swap')`, não `icon('arrows-up-down')`), o mesmo método do design
system em que este se inspira. Contorno em repouso; preenchido no estado ligado e no mapa.
Traço arredondado, o padrão do Tabler.

**Contexto.** A primeira escolha foi o Lucide, mas ele [não tem preenchido](https://lucide.dev/guide/advanced/filled-icons)
(é um pedido aberto há anos). Sem preenchido não há como unificar a interface e o mapa:
traço fino some sobre as linhas, e é por isso que Google Maps e Mapbox usam ícones
cheios no mapa.

**Por quê o Tabler.** Comparamos as bibliotecas conhecidas que têm os dois estilos e
todos os ícones do app:

| | Por que não |
|---|---|
| Material Symbols, Fluent | Ótimos, mas com a cara do Google e da Microsoft. O app quer cara própria. |
| Phosphor | MIT, os dois estilos em tudo, mas o visual não agradou, e o preenchido de ônibus e bici quase não muda do contorno. |
| Solar | Bonito, mas CC BY (pede crédito) e sem ícone de estacionamento. Fica como alternativa. |
| Remix | Licença nova desde jan/2026, possivelmente incompatível com a GPL. |
| Iconoir, Heroicons | Quase sem preenchido; sem ônibus, bici e trem. |

O Tabler é dos mais usados e ativos (5.200 ícones, 1.054 preenchidos), MIT, com traço de
2 px parecido com o que já tínhamos, e tem preenchido exatamente onde precisamos: ônibus,
bici, trem, estacionamento, aviso, casa, camadas, localização.

**Ainda em aberto.** A escolha é "por enquanto": a lacuna do metrô e o visual podem levar a
outra biblioteca. Por isso o vocabulário e os scripts não sabem qual biblioteca é (decisão
19).

**Emoji, nunca.** Muda de desenho em cada aparelho (o 🚌 do Android não é o do iPhone),
não segue a cor do texto nem o modo escuro, e não tem tamanho previsível.

### 17. SVGs copiados, sem dependência (2026-11-03)

**Decisão.** Os SVGs ficam commitados em `design/icons/tabler/outline` e `filled`, só os
que o vocabulário usa, na versão que ele fixa, com a licença e um `source.json` que diz de
onde vieram. Um script (`npm run icons:fetch`) baixa as cópias quando o vocabulário muda;
o build e o site não precisam de internet nem de pacote.

**Por quê.** O projeto valoriza poucas dependências. O pacote do Tabler traz 5.200 ícones
para usarmos duas dúzias. Com as cópias no repositório, um ícone novo aparece no diff do
PR, e o teste confere que nenhuma cópia sobrou ou faltou.

### 18. Ícones do `index.html` escritos pelo build (2026-11-03)

O `index.html` marca onde vai cada ícone (`<i data-icon="menu">`), e o build escreve o
`<svg>` ali mesmo. Alternativa descartada: preencher os ícones com JavaScript ao carregar,
que deixaria os botões vazios por um instante e custaria trabalho no celular a cada
abertura.

### 19. Vocabulário e scripts independentes de biblioteca (2026-11-03)

**Decisão.** O vocabulário guarda `library`, `version` e, por significado, o desenho em
cada estilo (`name`, `filled`). O `fetch-icons.mjs` tem uma tabela de bibliotecas (onde
cada uma publica seus SVGs); o `build-icons.mjs` não sabe qual é: cada SVG traz os próprios
atributos de desenho (`viewBox`, `fill`, `stroke`…), e o build só os repete.

**Por quê.** A troca de Lucide para Tabler mostrou o custo: sem isso, mudar de biblioteca
mexe em script, teste e documentação. Agora são três passos: ensinar ao `fetch-icons.mjs`
onde a nova publica, mudar o vocabulário, rodar `icons:fetch` e `build:icons`. O app não
muda, e o teste avisa se algum significado ficou sem desenho.
