# Logo TV Gominho

O logo é um desenho de giz de cera: um quadrado com as cores do arco-íris e o nome "TV GOMINHO" em azul embaixo. É o mesmo no site e no app.

Arquivos:

- `site/img/logo.webp`: no site, como imagem do topo e ícone da aba.
- `pacotes/interface/src/assets/tv-gominho-logo.webp`: no app, na tela de entrada e como ícone da aba.

O app também usa esse logo como marca d'água padrão no canto inferior direito da TV, enquanto passa um programa e a biblioteca não define a sua (`marca_dagua`; veja [configuracoes.md](configuracoes.md)). Nesse uso vai uma cópia pequena, de 224 px (`pacotes/interface/src/assets/tv-gominho-marca-dagua.webp`, ~22 KB), embutida no código do app (não como arquivo à parte), para funcionar também ao abrir o `index.html` direto do pendrive. Aí ele tem o efeito de vidro fosco (claro, quase sem cor, com brilho na borda e sombra suave), desenhado uma vez só ao abrir a TV (`pacotes/interface/src/components/glass-watermark.ts`), sem a folha de caderno.

Os dois arquivos são a mesma imagem (640 × 634, WebP com canal alfa, ~140 KB).

Como as letras azuis somem em fundo escuro, o logo aparece sempre sobre uma folha de caderno colada com fita (classe `.logo-paper` no site, `.welcome-logo` no app).

O logo anterior do app, uma TV prateada em 3D, foi trocado por este para o projeto ter um logo só.
