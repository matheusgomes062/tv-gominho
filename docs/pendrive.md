# Pendrive para qualquer TV

O objetivo: qualquer pessoa coloca o pendrive na TV, aperta play e assiste à TV Gominho, sem instalar nada.

O player embutido das TVs só toca arquivos de vídeo. Ele não roda o app, então a programação é **pré-renderizada**: a ferramenta `tv-gominho pendrive` monta a grade e grava o resultado como arquivos MP4 comuns. Ela usa o [ffmpeg](https://ffmpeg.org) (veja [ferramentas.md](ferramentas.md) para instalar).

## Como gerar

No computador, pela linha de comando (a tela "Criar pendrive" no app vem depois):

```sh
tv-gominho pendrive <biblioteca> --destino <pasta> [opções]
```

Por exemplo, 5 dias da grade `gominho-2003`, sem comerciais, no pendrive que o Windows chama de `E:`:

```sh
tv-gominho pendrive ./biblioteca --destino E:\ --grade gominho-2003 --dias 5 --sem-comerciais
```

Dentro do projeto, troque `tv-gominho` por `npm run cli --` (por exemplo, `npm run cli -- pendrive ./biblioteca --destino E:\ --simular`).

Dica: rode primeiro com `--simular`. Ele mostra, dia por dia, os horários, os itens, os intervalos comerciais e o tamanho estimado de cada arquivo, sem renderizar nada e sem gravar nada.

1. `<biblioteca>` é a pasta `biblioteca` (ou a pasta que a contém). As configurações vêm do `configuracoes.yaml` dela (veja [configuracoes.md](configuracoes.md)), inclusive o tema.
2. `--destino` é o pendrive (ou qualquer pasta). Ele não pode ficar dentro da biblioteca.
3. As opções abaixo valem **no lugar** das configurações da biblioteca. O que não for dito segue a biblioteca.
4. Gerar leva tempo: o ffmpeg recodifica todos os vídeos. Veja "Velocidade".

## Opções

| Opção | O que faz |
|---|---|
| `--destino`, `-d <pasta>` | Onde gravar. Obrigatória (menos com `--simular`) |
| `--grade`, `-g <nome>` | A grade, pelo nome ou pelo nome do arquivo (sem acento e sem diferença entre maiúsculas e minúsculas). Padrão: a primeira grade; se a biblioteca não tem grades, o Canal Automático |
| `--dias <n>` | Quantos **dias de exibição** da grade gerar (de 1 a 366). Padrão: 5 |
| `--a-partir-de AAAA-MM-DD` | O primeiro dia. Padrão: hoje, ou o próximo dia em que a grade vai ao ar |
| `--sem-crt` | Sem o efeito de TV de tubo: o vídeo só é ajustado ao tamanho da tela |
| `--crt suave\|media\|forte` | Intensidade do efeito CRT |
| `--curvatura <0-100>` | Curvatura da tela (0 = reta, sem cantos pretos) |
| `--sem-vinhetas` | Sem vinhetas (aberturas, encerramentos, intervalos escritos na grade) |
| `--sem-comerciais` | Sem comerciais e sem intervalos comerciais |
| `--intervalo-a-cada <n>` | Minutos de episódio entre os intervalos comerciais (0 a 30; 0 = só ao fim do episódio) |
| `--proporcao 4:3\|esticar\|original` | `4:3` (padrão) deixa barras pretas nas laterais; `esticar` enche a tela; `original` mantém a forma do vídeo |
| `--copiar-biblioteca` | Copia a biblioteca para `<destino>/biblioteca` (veja abaixo) |
| `--qualidade <n>` | Qualidade do vídeo (CRF do x264, de 0 a 51; menor = melhor e maior). Padrão: 22 |
| `--preset <nome>` | Velocidade do x264, de `ultrafast` a `veryslow`. Padrão: `veryfast`. Mais lento = arquivos menores |
| `--resolucao`, `-r 720\|480` | Linhas da imagem. `720` (padrão): 1280×720. `480`: 854×480, com cerca de metade do tamanho e mais compatível com TVs antigas. A TV Globinho era em definição padrão, então quase não se nota |
| `--paralelo <n>` | Quantos vídeos renderizar ao mesmo tempo (1 a 8). Padrão: automático (um para cada 4 núcleos do processador, de 1 a 3) |
| `--simular` | Só mostra o que seria gerado |
| `--ffmpeg <caminho>` | O ffmpeg a usar |

## O que é gerado

O mesmo motor de grade do app monta cada dia (o que passa, quais episódios, quais vinhetas e comerciais, os intervalos no meio dos episódios) e o resultado vira vídeo no estilo **`horario: do_inicio`** (veja [configuracoes.md](configuracoes.md)): o relógio não importa. Como a TV começa do início quando você aperta play:

- **Cada dia começa pelo primeiro bloco da grade**, como uma maratona. Os espaços entre os blocos são pulados (não tem "fora do ar" nem chuvisco).
- **Os dias são dias de exibição da grade.** Uma grade de segunda a sexta com `--dias 5` gera cinco dias, de segunda a sexta, e o fim de semana não conta (os episódios só avançam nos dias de exibição). Se você pedir a partir de um sábado, o primeiro dia é a segunda-feira.
- **Os episódios avançam de um dia para o outro**, exatamente como no app: o Dia 02 traz os episódios seguintes aos do Dia 01.
- **Os comerciais** seguem as configurações `intervalos` da biblioteca: cortes no meio dos episódios, ao fim de cada um, sorteados com a mesma semente do dia (os mesmos que o app mostraria nesse dia). Cada intervalo leva as vinhetas de entrada e de saída de `vinhetas/intervalos/` (veja [biblioteca.md](biblioteca.md)); `--sem-vinhetas` ou `intervalos.vinhetas: não` tiram essas vinhetas.
- Arquivos que faltam ou não podem ser lidos são pulados, com um aviso; o resto é gerado.

### O que não vai para o pendrive

Chuvisco de troca de canal, relógio na tela e o "fora do ar" não existem em arquivo de vídeo. O brilho que oscila, o tremido das linhas e a faixa de falha do CRT do app também não: eles são animações, e animação cara de codificar deixa o arquivo muito maior.

## Efeito CRT

É uma aproximação do efeito do app, feita com filtros do ffmpeg e aplicada à imagem 4:3 **antes** de colocar as barras pretas. `--sem-crt` desliga tudo: o vídeo só é redimensionado (e as barras pretas entram).

| Parte do efeito | Como é feita | Varia com |
|---|---|---|
| Linhas de varredura e "grade" de cores (3 pixels) | Uma máscara gerada uma vez e multiplicada por cada quadro (rápido, ao contrário de calcular a cada pixel) | `--crt`, e só existem com as linhas ligadas (`crt.linhas`) |
| Bordas escurecidas (vinheta) | Na mesma máscara | `--crt` |
| Brilho em volta das partes claras | Cópia desfocada misturada com o filtro `lighten` | `--crt` |
| Desalinhamento de cores (vermelho e azul) | `rgbashift` | `--crt` (em `suave` não há) |
| Tela abaulada, com cantos pretos | `lenscorrection`, com um zoom leve antes, para o meio de cada borda ficar no lugar | `--curvatura` (0 = sem nada) |
| Granulado | `noise` | `--crt` |
| Pretos levemente acinzentados | Soma na mesma etapa da máscara | `--crt` |

Os números (força das linhas, da vinheta, do brilho...) são os mesmos do app para `suave`, `media` e `forte`. A curvatura vai de 0 a 100 como no app. A aparência não é idêntica ao WebGL do app, só parecida.

## Estrutura do pendrive

```
E:\
  ASSISTA AQUI/
    Dia 01 - Parte 1.mp4
    Dia 01 - Parte 2.mp4
    Dia 02 - Parte 1.mp4
    ...
  biblioteca/            # só com --copiar-biblioteca: cópia da biblioteca para o app da TV Box
  LEIA-ME.txt
```

O mesmo pendrive funciona nos dois casos:
- **TV comum:** abra `ASSISTA AQUI` e toque o primeiro arquivo.
- **TV Box com o app:** o app encontra a pasta `biblioteca` e oferece a experiência completa, com configurações.

O `LEIA-ME.txt` explica em português como tocar na TV, o que tem em cada dia e com quais configurações o pendrive foi gerado. Também diz que o TV Gominho é software livre (GPL-3.0) e não tem ligação com a TV Globo nem com nenhuma emissora.

### `--copiar-biblioteca`

Copia tudo que o app enxerga da biblioteca (programas, vinhetas, grades, `configuracoes.yaml`...) para `<destino>/biblioteca`. Não copia arquivos ocultos (os que começam com ponto) nem a pasta `.originais` do conversor. Um arquivo que já está lá com o mesmo tamanho e a mesma data é pulado, então repetir o comando é rápido. Se o destino já é a pasta da biblioteca (a biblioteca já mora no pendrive), não há nada a copiar. Lembre que os vídeos ocupam espaço duas vezes: a biblioteca e os arquivos renderizados.

## Requisitos técnicos dos arquivos gerados

| Item | Valor | Motivo |
|---|---|---|
| Contêiner | MP4, com `faststart` | O mais aceito pelas TVs |
| Vídeo | H.264, perfil High, nível 4.0, `yuv420p`, cores BT.709. Com `--resolucao 480`: perfil Main, nível 3.1 | Compatível com TVs desde ~2012; o 480 também com as de antes. (Com `--preset ultrafast`, o x264 escolhe o perfil Constrained Baseline, que toca em tudo, mas é menos eficiente) |
| Resolução | 1280×720 (ou 854×480), imagem 4:3 com barras pretas nas laterais | Evita que a TV estique a imagem; resolução suficiente para o efeito CRT |
| Quadros | 25 ou 30 por segundo, constante | O que a maioria dos vídeos do dia já tem (todos são convertidos para esse; 50 e 60 contam como 25 e 30) |
| Taxa do vídeo | CRF 22 com teto de 6 Mb/s (`-maxrate`) | Qualidade constante, sem picos que as TVs não aguentam |
| Áudio | AAC-LC estéreo, 48 kHz, 160 kb/s (128 kb/s em 480) | Compatível com tudo |
| Volume | Normalizado (EBU R128, -16 LUFS) por arquivo, medido no arquivo inteiro | Episódios, vinhetas e comerciais tocam no mesmo volume; as partes de um episódio cortado pelos comerciais recebem o mesmo ganho |
| Tamanho máximo por arquivo | Menos de 4 GB (alvo: 3,5 GB) | Pendrives costumam vir em FAT32, que não aceita arquivos maiores. Cada dia é dividido em partes |
| Nomes | `Dia 01 - Parte 1.mp4` (números com zeros à esquerda) | A TV toca na ordem alfabética. Sem caracteres que o FAT32 não aceita |

### Como os dias são divididos em partes

A divisão é feita **depois** de renderizar, pelo tamanho real de cada item, não por estimativa. Uma parte nunca começa nem termina no meio de um vídeo e, sempre que possível, termina **logo depois de um intervalo comercial** (assim a próxima parte abre de volta no programa). Se não der, termina entre dois itens da grade, depois entre um trecho do episódio e o intervalo e, só em último caso, entre dois comerciais do mesmo intervalo. Se um único vídeo for maior que 3,5 GB, ele fica sozinho numa parte e o resumo avisa. Um dia com menos de 3,5 GB vira um arquivo só (`Parte 1`).

## Como funciona por dentro

1. **Grade do dia.** `planDay` (que episódio e que vinhetas) e `buildTimeline`, com as durações reais lidas pelo `ffprobe`, as configurações `intervalos` e `maxGapFill: 0`. Cada trecho de episódio cortado por um intervalo tem o ponto do arquivo em que começa (`fileOffset`) e a duração.
2. **Itens.** Cada item da linha do tempo vira um "item" a renderizar: um arquivo inteiro, ou um trecho (do quadro X ao quadro Y) de um episódio. Os pontos de corte são arredondados para quadros inteiros, assim os trechos de um episódio se juntam sem falha nem sobreposição.
3. **Itens intermediários.** O ffmpeg renderiza cada item em um MP4 já normalizado (mesmos codecs, tamanho, quadros, áudio), numa pasta de trabalho `.tv-gominho-tmp` dentro do destino. O nome do arquivo vem de uma chave: arquivo de origem (caminho, tamanho, data), trecho e todas as configurações que mudam a imagem ou o som. Itens iguais (o mesmo comercial em vários dias) são renderizados uma vez.
4. **Partes.** Os itens do dia são divididos como descrito acima e juntados com o *concat demuxer* do ffmpeg, sem recodificar (`-c copy`). Cada parte é conferida (H.264, áudio, duração) antes de receber o nome final.
5. **Limpeza.** Os itens que nenhum dia seguinte usa são apagados a cada dia; no fim, a pasta de trabalho inteira some.

O filtro de cada item, resumido (com CRT): `fps` → `scale` para a caixa de 960×720 (com barras se o vídeo não for 4:3) → planar RGB → brilho (`gblur` + `blend lighten`) → `rgbashift` → zoom + `lenscorrection` → `noise` → máscara (`lut2`) → `yuv420p` → barras pretas laterais.

## Velocidade

Renderizar é o trabalho pesado. Num PC de 12 núcleos, com o efeito CRT completo e o padrão de 3 vídeos ao mesmo tempo, a biblioteca de exemplo foi renderizada a 5 vezes o tempo real (1h09 de programação em 13 minutos); sem CRT, a mais de 15 vezes. Dicas:
- `--sem-crt` e `--preset ultrafast` são as maneiras mais rápidas (o arquivo fica maior).
- `--paralelo` aumenta quantos itens são renderizados juntos; ajuda quando o processador tem núcleos sobrando.
- Os volumes são medidos uma vez por arquivo (isso é bem rápido).

## Simular a TV: `tv-gominho verificar`

Sem uma TV por perto, dá para conferir o pendrive do jeito que o player USB da TV olharia:

```sh
tv-gominho verificar E:\
```

O comando lê cada vídeo de `ASSISTA AQUI` (ou de qualquer pasta, ou um vídeo solto) com o `ffprobe` e compara com o que as TVs aceitam. Os limites vêm do que os fabricantes publicam (a LG, por exemplo, lista H.264 até o nível 4.2 e 20 Mb/s em Full HD), apertados para servir em TVs a partir de ~2010:

| Confere | Erro (não toca) | Aviso (pode falhar em TVs antigas) |
|---|---|---|
| Formato | o que não é MP4, MKV, AVI, TS ou WMV | MKV, AVI, TS, WMV (MP4 é o que todas tocam) |
| Vídeo | perfil H.264 10 bits ou 4:2:2, cores fora de `yuv420p`, codecs que TV não toca (RealVideo...) | H.264 acima do nível 4.1, HEVC, DivX/Xvid, VP9, AV1, acima de 1080p ou de 30 quadros, mais de 20 Mb/s |
| Som | DTS, Opus, FLAC e outros | AC3/E-AC3, AAC que não é LC, mais de 2 canais ou de 48 kHz, vídeo sem som |
| Arquivo | 4 GB ou mais num pendrive FAT32, caracteres que o FAT32 não aceita, nome que começa com ponto | 4 GB ou mais em exFAT, índice (`moov`) no fim do arquivo, acentos no nome |
| Pendrive | | exFAT (TVs de antes de ~2012 não leem), NTFS (muitas TVs não leem) |

Termina com código 1 se algum vídeo tem erro. O que o `tv-gominho pendrive` gera passa sem avisos; serve também para conferir vídeos baixados antes de copiá-los para a TV.

## Formatar o pendrive

Toda TV com USB lê **FAT32**; as de 2012 em diante costumam ler também **exFAT**. **NTFS** (o padrão de HDs externos no Windows) muitas TVs não leem. O FAT32 não aceita arquivos de 4 GB ou mais, por isso o `pendrive` divide cada dia em partes.

- Pendrives de até 32 GB: no Windows, clique com o botão direito na unidade, **Formatar**, sistema de arquivos **FAT32**.
- Maiores que 32 GB: o Windows não oferece FAT32 para eles. Use **exFAT** (se a TV for de 2012 em diante) ou um programa de formatação FAT32.
- Formatar **apaga tudo** o que está no pendrive.

## Interrupção, repetição e espaço em disco

- **Ctrl+C** interrompe com segurança: arquivos pela metade são apagados e o que já foi renderizado fica na pasta `.tv-gominho-tmp`. Rodar o mesmo comando de novo continua de onde parou. Dias já terminados (e com os arquivos ainda no pendrive) são pulados.
- Mudar qualquer configuração que altere a imagem ou o som gera os itens de novo; o que não mudou é reaproveitado enquanto a pasta de trabalho existir.
- Se algo falhar (um vídeo que o ffmpeg não consegue ler, por exemplo), o item é pulado com um aviso, a pasta de trabalho é mantida e o código de saída é diferente de zero.
- **Espaço:** antes de começar, o comando estima o espaço necessário (o resultado, os itens de um dia e a cópia da biblioteca) e **avisa** se o pendrive parece pequeno. O aviso não impede de continuar: se o espaço acabar, o comando para com erro e o que já foi gerado fica guardado.
- Arquivos `Dia NN - Parte N.mp4` de uma geração anterior, que não foram refeitos, continuam na pasta e tocariam junto: o resumo avisa quais são. Apague-os à mão.
- O destino nunca é gravado através de atalhos (links simbólicos): se `ASSISTA AQUI` for um atalho para outra pasta, o comando para.

## Limitações

- Não há relógio ao vivo: a programação começa do início ao apertar play.
- Para mudar as configurações (por exemplo, tirar o CRT), é preciso gerar o pendrive de novo.
- Gerar o pendrive leva tempo, porque o ffmpeg precisa recodificar todos os vídeos.
- O efeito CRT é uma aproximação: não tem as partes animadas do app (oscilação de brilho, tremido, faixa de falha).
- Cada dia tem os intervalos comerciais sorteados no momento de gerar; gerar de novo no mesmo dia dá o mesmo resultado, mas os comerciais de uma biblioteca nova mudam.
- Ainda não testado em vários modelos de TV (veja [roteiro.md](roteiro.md)). Se um arquivo não tocar na sua TV, abra uma issue com o modelo da TV e o `LEIA-ME.txt` do pendrive.
