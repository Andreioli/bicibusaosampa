# Design do Bici Busão Sampa

Como o visual do app é organizado, como mudar alguma coisa sem quebrar o resto e por
que escolhemos assim. Vale para quem desenha, para quem programa e para a IA que
trabalha no repositório: o CLAUDE.md aponta para cá.

O resumo: **toda cor, sombra e fonte do app é um token**. Os tokens ficam em JSON no
padrão [DTCG 2025.10](https://www.designtokens.org/tr/2025.10/) do W3C, em
`design/tokens/`. Um script sem dependências gera deles o CSS e o JS que o site carrega.
O site continua sem build no deploy: os arquivos gerados são commitados, como os dados
em `public/data/`.

```
design/tokens/                 a fonte (você edita aqui)
  ref.tokens.json              a paleta
  ui.tokens.json               interface que não muda entre claro e escuro
  map.tokens.json              a simbologia do mapa
  brand.tokens.json            cores do app fora da página (PWA)
  themes/light.tokens.json     interface no modo claro, com descrições e metadados
  themes/dark.tokens.json      interface no modo escuro, só valores
  bicibusao.resolver.json      como os arquivos se combinam em claro e escuro
        │
        ▼  npm run build:tokens   (scripts/build-tokens.mjs)
        │
  public/tokens.css            variáveis CSS, claro e escuro       (gerado)
  public/js/tokens.js          os mesmos valores para JavaScript   (gerado)
  DESIGN.md, tabelas abaixo    a lista de tokens deste documento   (gerado)
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
`ref.color.alpha.<cor>-<opacidade>` (`ref.color.alpha.black-18`).

### Claro e escuro

O `bicibusao.resolver.json` segue o
[Resolver](https://www.designtokens.org/tr/2025.10/resolver/) da spec. Ele junta os
arquivos base e escolhe `themes/light` ou `themes/dark`. Cada token de tema existe nos dois
arquivos com o mesmo nome. A descrição e os metadados ficam só no claro, para não
divergirem, e o teste recusa um token que exista num arquivo e falte no outro.

No CSS gerado, o escuro é um bloco `@media (prefers-color-scheme: dark)` com só os
tokens que mudam.

### Metadados

Cada papel tem uma descrição (`$description`) que diz **para que serve**, nas palavras de
quem vai escolher: "Texto de apoio: títulos de seção, horários, detalhes". Não diz o
valor nem a camada, que o nome e o arquivo já dizem.

O resto fica em `$extensions["info.bicisampa"]`, um espaço de nomes nosso, que outras
ferramentas DTCG ignoram sem erro:

| Campo | Para quê |
|---|---|
| `usage` | Onde usar, de uma lista fixa: `text`, `icon`, `background`, `border`, `outline`, `line`, `fill`, `shadow`, `text-shadow`, `font`, `width`, `height`, `theme-color`. O teste recusa outro termo. |
| `avoid` | Onde não usar, em frases curtas em português. |
| `contrast` | Pares que precisam de contraste mínimo: `[{ "against": "ui.surface.page", "min": 4.5 }]`. O teste mede cada par nos dois esquemas. |
| `departure` | Dentro de um par de `contrast`: uma exceção conhecida, com `rule`, `reason` e `since`. Veja "Quando o contraste falha". |

Esses dados servem a gente e servem a máquina: uma IA que abre `map.tokens.json` sabe para
que é cada cor, onde não usar e com o que precisa contrastar, sem adivinhar.

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

### Criar um token

Crie quando houver um trabalho novo, não um valor novo. Antes, veja se um papel existente
já faz esse trabalho. Um token novo precisa de `$value` apontando para a paleta, de
`$description`, de `usage` e, se for texto ou símbolo sobre uma cor, de `contrast`.

### Usar um token

| Onde | Como |
|---|---|
| CSS | `color: var(--ui-content-secondary);` |
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
- Sombras e a fonte também vêm de tokens. **[revisão]**: o teste não consegue
  reconhecer uma sombra ou uma fonte escrita à mão.
- A paleta (`ref`) nunca aponta para outro token. **[automática]**
- Um papel aponta para a paleta, nunca para um valor cru. As exceções estão declaradas no
  teste, cada uma com o motivo (hoje: `ui.size.touch`, `ui.font.family.base` e os
  comprimentos das sombras, cuja cor ainda vem da paleta). Uma exceção que deixa de ser
  usada também faz o teste falhar. **[automática]**
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
- Espaçamento, raios e tamanhos de texto também viram tokens, numa escala. **[meta]**

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
| `ui.size.touch` | `44px` | Lado mínimo de tudo que se toca (Apple HIG: 44 pt). |
| `ui.surface.page` | `#ffffff` · escuro `#0c0a09` | Fundo da página e dos campos. |
| `ui.surface.panel` | `rgb(255 255 255 / 0.97)` · escuro `rgb(28 25 23 / 0.97)` | Painéis e botões sobre o mapa; quase opaco, para o mapa aparecer de leve por trás. |
| `ui.content.primary` | `#1c1917` · escuro `#f5f5f4` | Texto principal. |
| `ui.content.secondary` | `#57534e` · escuro `#a8a29e` | Texto de apoio: títulos de seção, horários, detalhes. |
| `ui.border.default` | `#e7e5e4` · escuro `#292524` | Bordas de painéis, campos e separadores de lista. |
| `ui.accent.default` | `#0f766e` · escuro `#2dd4bf` | Ação e seleção: botão ativo, foco, links, opção escolhida. |
| `ui.accent.on` | `#ffffff` · escuro `#042f2e` | Texto sobre o destaque. |
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
