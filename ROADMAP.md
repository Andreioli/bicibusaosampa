# Roadmap

Melhorias que já têm direção mas ainda não foram feitas. Cada item diz o que é, por que
importa, a abordagem escolhida (quando já há uma) e o que falta decidir. Quem pegar um item
move a decisão para o DESIGN.md (se for de design) ou para o commit, e tira o item daqui.

## Planejador

### Chegar até um horário

**O quê.** Hoje só dá para escolher a hora de saída. Quem precisa estar em casa às 17h, ou
no trabalho às 8h30, tem que tentar saídas até acertar.

**Abordagem escolhida.** Em "Mais opções", alternar entre "Sair às" e "Chegar até". O
"Chegar até" roda a busca normal para algumas saídas antes do horário pedido e mostra as
opções que chegam a tempo, a que sai mais tarde primeiro. Não exige um segundo motor de
busca; fica um pouco mais lento.

**Fora.** Busca reversa no RAPTOR (de trás para frente, como o OpenTripPlanner faz): exata,
mas seria um segundo motor, com os dois critérios (tempo e kcal), para manter.

### Paranapiacaba sem a Linha 10

**O quê.** De Tatuapé até Paranapiacaba (sábado de manhã, bici liberada no trem), o
planejador só oferece pedalar 53 km ou ir a pé. O caminho óbvio, Linha 10-Turquesa até Rio
Grande da Serra e ~13 km de bici, não aparece.

**A investigar.** Se a Linha 10 está inteira em `data/routing/transit.json`, se há um limite
no trecho final de bici, ou se a malha de ruas (`streets.bin`) não chega à serra. Só
diagnóstico por enquanto.

## Interface

### Pontos de parada da folha no celular

**O quê.** A folha do menu tem alturas fixas (espiada, 62% com rota), mas arrastar não
encaixa em pontos definidos. Definir os pontos (espiada, metade, cheia) e o gesto entre eles.

### Estado só das linhas da rota

**O quê.** Com uma rota na tela, a aba Linhas poderia mostrar primeiro (ou só) as linhas que
a rota usa, em vez de todas.

## Mapa

### Seta branca nos ônibus amarelos e laranjas

**O quê.** A seta branca do ônibus tem contraste de 1,92:1 sobre o amarelo e 2,80:1 sobre o
laranja, abaixo dos 3:1 para símbolos. Está registrada como exceção nos tokens (DESIGN.md,
decisão 9). Corrigir muda a cara do ícone, e as cores são decisão do mantenedor.
