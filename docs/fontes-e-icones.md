# Fontes e ícones

O aplicativo funciona **sem internet** (inclusive a partir de um pendrive ou de uma TV box), então nenhuma fonte ou ícone vem de CDN: tudo é embutido na versão compilada. As fontes chegam pelos pacotes npm `@fontsource/*` (só o subconjunto latino, que cobre o português) e os ícones pela biblioteca `lucide-react`, importados um a um (só entram no pacote os ícones usados).

As licenças completas vão junto com o aplicativo, na pasta `licencas/` do pacote compilado (origem: `pacotes/interface/public/licencas/`).

## Fontes por tema

Cada tema (`tema`) escolhe um **estilo dos textos** (TV antiga, Fita VHS ou TV moderna), e cada estilo tem suas fontes. Regra geral: **números e rótulos curtos** usam a fonte "de época"; **descrições longas** usam uma fonte de leitura fácil, porque o painel é lido a 3 metros de distância. A biblioteca (grade de programas, página do programa, avisos) usa sempre a fonte moderna.

| Onde | TV antiga | Fita VHS | TV moderna |
|---|---|---|---|
| Número do canal, relógio, título da barra de informações | Press Start 2P | VT323 | Figtree |
| Nome do canal, episódio, "Fora do ar", menus (títulos, rótulos, valores) | Jersey 15 | VT323 | Figtree |
| Descrições e dicas nos painéis | Figtree | Share Tech Mono | Figtree |
| Biblioteca, Boas-vindas, Avisos | Figtree | Figtree | Figtree |

### Pacotes, fontes e licenças

| Fonte | Uso | Pacote npm | Licença | Direitos autorais (conforme o arquivo de licença) |
|---|---|---|---|---|
| **Press Start 2P** | TV antiga: números do canal, relógio | `@fontsource/press-start-2p` | SIL OFL 1.1 | The Press Start 2P Project Authors (Cody, zone38.net) |
| **Jersey 15** | TV antiga: menus e textos da tela | `@fontsource/jersey-15` | SIL OFL 1.1 | The Soft Type Project Authors |
| **VT323** | Fita VHS: textos da tela e menus | `@fontsource/vt323` | SIL OFL 1.1 | The VT323 Project Authors (Peter Hull) |
| **Share Tech Mono** | Fita VHS: descrições | `@fontsource/share-tech-mono` | SIL OFL 1.1 | Carrois Type Design (Ralph du Carrois) |
| **Figtree** | TV moderna, biblioteca e descrições | `@fontsource/figtree` | SIL OFL 1.1 | The Figtree Project Authors (Erik D. Kennedy) |

A OFL permite usar, copiar e redistribuir as fontes junto com o programa (inclusive em um pendrive), desde que o texto da licença acompanhe e as fontes não sejam vendidas sozinhas. O texto de cada licença está em `licencas/fonte-*.txt`.

### Por que cada escolha

**TV antiga.** Os OSDs das TVs de tubo vendidas no Brasil nos anos 90 (Philco, CCE, Semp Toshiba, Philips, Sharp) desenhavam o canal e o volume com um gerador de caracteres de matriz de pontos: letras maiúsculas grossas, em baixa resolução, quase sempre em **verde** (às vezes branco) com uma borda escura. Não existe uma fonte "oficial" desses aparelhos, então a escolha foi a mais próxima:

- **Press Start 2P** (grade de 8×8 pixels, maiúsculas largas) é a que mais lembra um gerador de caracteres de TV. Só é usada em tamanhos múltiplos de 8 px (`round()` no CSS), para os pixels caírem inteiros, e com uma borda preta dura (sem brilho), como no tubo. Fica restrita a textos curtos: é larga demais para frases.
- **Jersey 15** é uma fonte de pixels em negrito, estreita e muito legível, usada nos menus. Foi escolhida depois de testar a **Pixelify Sans**, que parecia mais "amigável", mas em tamanhos pequenos a letra C se fecha e vira O ("CRT" lia-se "ORT"), o que é inaceitável a 3 m. A VT323 e a Silkscreen também foram vistas e descartadas para menus (finas demais ou só maiúsculas).

**Fita VHS.** O OSD de um videocassete (PLAY ▶, "SP 0:12:04", o número do canal) é feito de letras brancas, quadradas e em maiúsculas, com borda escura. A fonte mais citada para isso é a **"VCR OSD Mono"**, mas ela é distribuída em sites de fontes com a marca "100% free" sem texto de licença verificável (nem arquivo de licença do autor), então **não foi usada**: não dá para garantir que possa ser redistribuída num projeto GPL. No lugar entrou a **VT323** (OFL), que tem o mesmo ar de terminal/matriz de pontos; como ela é pequena para o tamanho nominal, os textos usam fatores maiores (1,3×). Para descrições longas, a **Share Tech Mono** (também OFL) mantém o clima monoespaçado e é mais legível que a VT323 em tamanhos pequenos. O "▶" é desenhado em CSS, para não depender de nenhuma fonte ter esse símbolo.

**TV moderna.** O menu das TVs Samsung (One UI / Tizen) usa a SamsungOne (e, a partir da One UI 6, a "One UI Sans"), que são **fontes proprietárias** da Samsung e não podem ser redistribuídas. A alternativa livre mais próxima em desenho (sem serifa, geométrica e amigável, com bom peso em negrito) é a **Figtree**. Inter, Manrope, Nunito Sans e Plus Jakarta Sans também foram comparadas; a Figtree ficou mais perto no peso e na abertura das letras, e já serve como fonte da biblioteca. Não usamos o nome, o logotipo nem os arquivos da Samsung: é só uma inspiração visual.

Sobre as **vinhetas da TV Globinho** da época: a pesquisa não encontrou nenhuma fonte livre e identificável que corresponda às artes de abertura da Globo, então o aplicativo não tenta imitá-las. O OSD do aparelho (canal, relógio) segue o estilo de cada TV, e a barra de informações mostra só o que está no ar agora (programa, episódio e parte), sem o "A seguir".

A pesquisa de fontes de OSD de TVs brasileiras também não achou uma fonte catalogada por fabricante; as escolhas acima vêm da comparação visual de candidatas livres com o estilo descrito (letras de matriz de pontos, maiúsculas, verde ou branco com borda escura).

## Ícones

Os ícones são do **Lucide** (`lucide-react`), licença **ISC** (https://lucide.dev), todos desenhados em contorno numa grade de 24×24, o que mantém uma espessura de traço única. Cada ícone é importado individualmente em `pacotes/interface/src/components/Icon.tsx`, que também guarda o nome usado pelo restante do aplicativo (`tube`, `ads`, `settings`...). O tamanho vem do CSS (unidade `--u`, que acompanha a altura da tela) e a cor, de `currentColor`. Nos estilos TV antiga e Fita VHS, os traços ganham pontas quadradas e quinas retas, para combinar com as letras de pixel. O texto da licença está em `licencas/icones-lucide.txt`.

## Como trocar ou acrescentar uma fonte

1. `npm i -w @tv-chuvisco/interface @fontsource/<nome>` (confira que a licença do pacote é OFL ou Apache 2.0; **não** use fontes sem licença clara).
2. Importe só o arquivo `latin-<peso>.css` em `pacotes/interface/src/fonts.ts`.
3. Aponte a fonte nas variáveis de cada estilo em `styles.css` (`--ff-osd`, `--ff-osd-text`, `--ff-display`, `--ff-body`).
4. Copie o `LICENSE` do pacote para `pacotes/interface/public/licencas/` e atualize esta página.
