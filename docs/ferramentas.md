# Ferramentas de linha de comando

A TV Gominho tem uma ferramenta de linha de comando, o `tv-gominho`, para o trabalho que o navegador não faz: converter arquivos antigos, montar a grade e gerar o [pendrive](pendrive.md). Ela usa o [ffmpeg](https://ffmpeg.org).

| Comando | O que faz | Status |
|---|---|---|
| `converter` | Converte vídeos antigos ou incompatíveis da biblioteca para MP4 (H.264 + AAC) | Pronto |
| `organizar` | Arruma vídeos baixados na biblioteca, reconhecidos pelo Jev (IA, opcional, precisa de internet e chave) | Pronto |
| `grade` | Monta o canal TV Gominho (a grade), no estilo da TV Globinho, com os programas da biblioteca | Pronto |
| `pendrive` | Gera o pendrive com a programação pré-renderizada em MP4, para tocar em qualquer TV | Pronto |
| `verificar` | Confere se uma TV deve tocar os vídeos de um pendrive (simula o player USB da TV) | Pronto |
| `servir` | Abre o app no navegador, ou em outros aparelhos da rede e no Raspberry Pi, já com a biblioteca | Pronto |
| `ajuda` | Mostra os comandos e as opções | Pronto |

## Requisitos

- [Node.js](https://nodejs.org) 22 ou mais novo.
- O **ffmpeg** (que inclui o `ffprobe`) instalado:

| Sistema | Como instalar |
|---|---|
| Windows | `winget install Gyan.FFmpeg` (depois abra um novo terminal) |
| Debian / Ubuntu / Raspberry Pi OS | `sudo apt install ffmpeg` |
| macOS | `brew install ffmpeg` |

A ferramenta procura o ffmpeg nesta ordem: opção `--ffmpeg <caminho>` (o arquivo ou a pasta onde ele está), variável de ambiente `FFMPEG`, o `PATH` do sistema e, no Windows, a pasta onde o `winget` instala. O `ffprobe` é procurado ao lado do ffmpeg. Se não encontrar, a ferramenta explica como instalar.

## Como rodar

Dentro do projeto (depois de `npm install`):

```sh
npm run cli -- ajuda
npm run cli -- converter ./biblioteca --simular
```

O `npm run cli` compila a ferramenta para `pacotes/cli/dist/tv-gominho.mjs` (um arquivo só, que não precisa de `node_modules`) e a executa. Depois de compilada, também dá para rodar direto:

```sh
npm run build -w @tv-gominho/cli
node pacotes/cli/dist/tv-gominho.mjs converter ./biblioteca
```

Em todos os comandos, `--ajuda` mostra as opções, e **Ctrl+C** interrompe com segurança (o arquivo parcial é apagado).

## `converter`

```
tv-gominho converter <biblioteca> [opções]
```

Procura em `programas/` e `vinhetas/` os vídeos que o app não toca e converte cada um para MP4:

- **Formatos antigos:** AVI, MKV, WMV, RMVB, FLV, MPG, VOB, TS, 3GP e outros (os mesmos que o app avisa que "ainda não são suportados").
- **MP4/MOV/M4V com codecs incompatíveis:** o formato é tocado, mas o conteúdo não. Exemplos: vídeo HEVC (H.265), MPEG-4 Parte 2 (DivX/Xvid) ou de 10 bits; áudio AC3 ou DTS. A análise é feita com o `ffprobe`.

Arquivos que já são MP4 com H.264 + AAC (ou MP3) são deixados em paz.

`<biblioteca>` é a pasta `biblioteca` ou a pasta que a contém (por exemplo, o pendrive). Por segurança, a ferramenta **só trabalha em pastas que parecem uma biblioteca** (com `programas/`, `vinhetas/` ou `grades/`) e só mexe em arquivos dentro dela.

### O que é feito com cada arquivo

| Situação | O que acontece |
|---|---|
| MKV/AVI/etc. com vídeo H.264 e áudio AAC estéreo | **Só troca o contêiner** (sem recodificar): segundos por arquivo, sem perda de qualidade |
| Vídeo compatível, áudio incompatível (AC3, DTS, MP3, AAC 5.1) | Copia o vídeo e converte só o áudio |
| Vídeo incompatível | Recodifica o vídeo |
| MP4 que já funciona | Pulado |
| Já existe um `.mp4` válido com o mesmo nome (de uma execução anterior) | Pulado: só cuida do original, se for o caso |

O vídeo recodificado fica em **H.264 (perfil High, `yuv420p`)**, com CRF 20 por padrão, e o áudio em **AAC estéreo, 48 kHz, 160 kb/s**. Todo arquivo sai com `+faststart`. Se o arquivo tem várias faixas de áudio, vale a primeira (use `--faixa-audio` para trocar). Legendas e outras faixas não vão para o MP4.

O arquivo novo fica **ao lado do original**, com a extensão `.mp4`. Ele é escrito com um nome temporário (`.nome.parcial.mp4`, oculto) e só recebe o nome final depois de conferido: precisa ter vídeo H.264, áudio (se o original tinha) e a duração do original. Se algo der errado, o temporário é apagado e o original não é tocado.

### O que acontece com os originais

**Nada é apagado, a menos que você peça.** Por padrão, depois de converter, o original é **movido** para a pasta `.originais` da biblioteca, mantendo as subpastas:

```
biblioteca/programas/dragon-ball/episodios/001.avi
   vira
biblioteca/.originais/programas/dragon-ball/episodios/001.avi
```

A TV Gominho ignora pastas que começam com ponto, então os originais não atrapalham. Quando conferir que está tudo certo, apague a pasta `.originais` para liberar espaço. Se já existir um arquivo com o mesmo nome lá, o novo ganha um sufixo (`001 (2).avi`).

| Opção | Efeito nos originais |
|---|---|
| (padrão) | Movidos para `.originais/` |
| `--manter-originais` | Ficam onde estão. O app continua avisando sobre o formato antigo enquanto o `.avi`/`.mkv` estiver na biblioteca. Exceção: um `.mp4` que precisa ser recodificado tem o mesmo nome do arquivo novo, então esse original sempre vai para `.originais/` |
| `--apagar-originais` | Apagados depois que o MP4 novo foi conferido. Não dá para desfazer |

### Opções

| Opção | O que faz |
|---|---|
| `--simular` | Só mostra o que seria feito e por quê. Não altera nada |
| `--qualidade <n>` | Qualidade do vídeo recodificado (CRF do x264, de 0 a 51). Menor = melhor e maior. Padrão: 20 |
| `--preset <nome>` | Velocidade do x264: `ultrafast`, `superfast`, `veryfast`, `faster`, `fast`, `medium`, `slow`, `slower`, `veryslow`. Padrão: `medium`. Mais lento gera arquivos menores |
| `--normalizar-audio` | Iguala o volume (EBU R128, -16 LUFS) dos arquivos que estão sendo convertidos. O áudio desses arquivos é sempre recodificado |
| `--duas-passadas` | Com `--normalizar-audio`: mede o volume do arquivo antes de normalizar. Mais preciso, um pouco mais lento |
| `--faixa-audio <n>` | Faixa de áudio a manter, começando em 1 (útil em MKV com dublagem e áudio original). Padrão: 1 |
| `--manter-originais` | Veja acima |
| `--apagar-originais` | Veja acima |
| `--ffmpeg <caminho>` | ffmpeg a usar (o arquivo ou a pasta dele) |
| `--ajuda` | Mostra a ajuda do comando |

### Exemplos

Ver o que seria feito, sem alterar nada:

```sh
npm run cli -- converter ./biblioteca --simular
```

```
Analisando 6 vídeos...
6 vídeos analisados; 1 já toca sem conversão.

O que seria feito:
  [converter] programas/show-a/episodios/001 - Avi.avi
      formato .avi não é suportado; vídeo MPEG-4 Parte 2 (precisa ser H.264); áudio MP3 (será AAC)
  [trocar contêiner] programas/show-a/episodios/002 - Mkv.mkv
      formato .mkv não é suportado; só troca o contêiner, sem recodificar
  [converter] programas/show-b/episodios/001 - Hevc.mp4
      vídeo HEVC (H.265) (precisa ser H.264)

3 arquivos para converter (1 só troca o contêiner), 18s de vídeo no total.
Os originais seriam movidos para .originais/ (nada é apagado).
```

Converter tudo, com o volume igualado:

```sh
npm run cli -- converter E:\biblioteca --normalizar-audio
```

Capricho máximo (demora bastante, gera arquivos menores):

```sh
npm run cli -- converter ./biblioteca --preset slow --qualidade 18
```

Usar um ffmpeg que não está no `PATH`:

```sh
npm run cli -- converter ./biblioteca --ffmpeg "C:\ffmpeg\bin\ffmpeg.exe"
```

### Interrupções e repetição

Pode interromper com **Ctrl+C** a qualquer momento: o arquivo parcial é apagado e nenhum original é movido pela conversão em andamento. Rodar o mesmo comando de novo continua de onde parou, porque o que já foi convertido é reconhecido e pulado. O comando termina com um resumo (convertidos, falhas, espaço, tempo) e código de saída diferente de zero se algum arquivo falhou.

## `organizar`

```
tv-gominho organizar <pasta de downloads> <biblioteca> [--simular] [--copiar]
```

Pega uma pasta de vídeos baixados, com nomes de todo jeito (`DBZ_Episodio 001_WwW.Site.Biz.avi`, `spongebob 1x07 dublado.avi`, `volta ja globinho 2004.avi`), e coloca cada um no lugar certo da [biblioteca](biblioteca.md):

| O que é | Para onde vai |
|---|---|
| Episódio de um programa da [lista da TV Globinho](programas-tv-globinho.md) | `programas/<programa>/episodios/` (em `temporada-NN/` quando o nome diz a temporada), com um `programa.yaml` com o título |
| Episódio de outro programa | `programas/<nome da pasta>/episodios/` |
| Abertura e encerramento do programa infantil | `vinhetas/aberturas/<emissora>/` e `vinhetas/encerramentos/<emissora>/` |
| Vinheta de intervalo | `vinhetas/intervalos/<emissora>/`, com `entrada` ou `saida` no começo do nome quando ela é de ida ou de volta |
| Comercial, chamada | `vinhetas/comerciais/`, `vinhetas/chamadas/` |
| Filme, amostra, making of, música de abertura de desenho | Fica onde está |

Quem reconhece os arquivos é o **Jev**, um modelo de IA da [TypeSafe](https://typesafe.ai). É o único comando que usa a internet, e é opcional: o resto da TV Gominho funciona sem ele. **Só os nomes dos arquivos e das pastas são enviados; os vídeos não saem do computador.** O Jev não inventa nada: ele escolhe entre opções conhecidas (um programa da lista ou "outro", o tipo do vídeo, a emissora da vinheta), e os caminhos são montados pela ferramenta.

Para usar, crie uma chave na TypeSafe e coloque no arquivo `.env` da raiz do projeto (veja `.env.example`), ou na variável de ambiente `TYPESAFE_API_KEY`:

```
TYPESAFE_API_KEY=sua-chave
```

O comando segue algumas regras:

- **Quando o Jev não tem certeza**, o arquivo fica onde está e aparece em "Para revisar", com as duas opções mais prováveis (por exemplo, `Novos/A Volta de Goku.avi`: "dragon-ball-z 56% ou dragon-ball 35%"). É só renomear ou mover à mão.
- **Nada é apagado nem sobrescrito.** Um arquivo que já existe na biblioteca é pulado. Entre discos diferentes, mover é copiar, conferir o tamanho e só então apagar o original. `--copiar` deixa os originais onde estão.
- **Um registro** do que foi para onde fica em `<biblioteca>/.tv-gominho/organizar-<data>.json`.
- **As respostas ficam guardadas** em `<pasta de downloads>/.tv-gominho/jev.json`: rodar com `--simular` e depois de verdade pergunta uma vez só.
- Vídeos em formatos que o app não toca (AVI, MKV...) vão para a biblioteca do mesmo jeito; depois rode o `converter`.

O custo é pequeno: o programa é perguntado uma vez por pasta, e o tipo de cada vídeo vai em lotes de 20 arquivos, cerca de 650 tokens por arquivo numa pasta grande.

## `grade`

Prefere montar pela tela? No app, Menu → Programação abre o assistente "Montar a semana", que usa este mesmo gerador (veja [grade.md](grade.md#montar-a-semana-pelo-app)).

```
tv-gominho grade <biblioteca> [opções]
```

Monta o canal TV Gominho, no estilo da TV Globinho, com o que está na biblioteca e grava `grades/tv-gominho.yaml`. Você só coloca os episódios em `programas/` e as vinhetas em `vinhetas/`; a grade sai pronta:

- Cada bloco começa com uma **abertura**, passa os programas em **rodízio**, com uma **chamada** de `vinhetas/chamadas/` entre eles, e termina com um **encerramento**.
- O tamanho do bloco já conta os **intervalos comerciais** e as **vinhetas de intervalo** (as configurações `intervalos` da biblioteca). A duração de cada vídeo vem do ffprobe; sem ffmpeg, valem durações típicas.
- Desenhos curtos (menos de 13 minutos, como Bob Esponja) passam **dois episódios seguidos**.
- Com `--epoca <ano>`, a abertura, o encerramento e as vinhetas de intervalo são os daquele ano, pelo ano no nome da pasta ou do arquivo (`tv-globinho-2003-2009/`, `Abertura (2009-2014).mp4`). Programas com `ano` (no `programa.yaml`) depois da época ficam de fora.
- Vinhetas com `globinho` no caminho têm preferência (`--marca` troca a palavra).

```sh
tv-gominho grade ./biblioteca --epoca 2004 --simular      # só mostra
tv-gominho grade ./biblioteca --epoca 2004                # grava grades/tv-gominho.yaml
tv-gominho grade ./biblioteca -p dragon-ball-z,pokemon,digimon -b 08:00-10:00,10:30-12:00 --arquivo manha
```

| Opção | O que faz |
|---|---|
| `--nome <texto>` | Nome do canal. Padrão: `TV Gominho` |
| `--programas`, `-p a,b,c` | Pastas dos programas, na ordem do rodízio. Padrão: todos com episódios, numa ordem embaralhada fixa |
| `--blocos`, `-b` | Blocos com início e fim: `08:00-12:00` (padrão) ou `08:00-10:00,14:00-17:30` |
| `--epoca`, `-e <ano>` | Vinhetas e programas daquele ano |
| `--marca <palavra>` | Prefere vinhetas com essa palavra no caminho. Padrão: `globinho` |
| `--dias seg,ter,...` | Dias da semana. Padrão: segunda a sexta |
| `--a-partir-de AAAA-MM-DD` | Estreia da grade: o primeiro episódio de cada programa passa nesse dia. Padrão: hoje |
| `--arquivo <nome>` | Nome do arquivo em `grades/`. Padrão: `tv-gominho` |
| `--substituir` | Grava por cima de uma grade que já existe |
| `--simular` | Mostra a grade sem gravar |

A grade gerada é um arquivo comum, com o horário estimado de cada programa em comentários: dá para editar à vontade (veja [grade.md](grade.md)). Sem nenhuma grade na biblioteca, o app monta sozinho um **Canal Automático** do mesmo jeito, com cada programa uma vez.

## `pendrive`

```
tv-gominho pendrive <biblioteca> --destino <pasta> [opções]
```

Monta a programação de alguns dias da grade e grava arquivos MP4 comuns (`ASSISTA AQUI/Dia 01 - Parte 1.mp4`...) que qualquer TV toca pelo USB, com o efeito CRT feito em filtros do ffmpeg, volume igualado e partes de menos de 4 GB. Tudo sobre as opções, o que é gerado, a velocidade e as limitações está em [pendrive.md](pendrive.md). Para ver o que seria gerado sem renderizar nada:

```sh
npm run cli -- pendrive ./biblioteca --destino E:\ --dias 3 --simular
```

## `verificar`

```
tv-gominho verificar <pendrive, pasta ou vídeo>
```

Confere cada vídeo como o player USB de uma TV faria: formato, codecs, perfil e nível do H.264, som, tamanho (FAT32), nomes e o sistema de arquivos do pendrive. Os detalhes estão em [pendrive.md](pendrive.md#simular-a-tv-tv-gominho-verificar).

## `servir`

```
tv-gominho servir <biblioteca> [--porta 8080] [--rede] [--abrir] [--editar]
```

Entrega o app e a biblioteca por HTTP: abra `http://localhost:8080` em qualquer navegador e a TV já começa, sem escolher pasta. É o que o [Raspberry Pi](raspberry-pi.md) usa.

- Sem `--rede`, só o próprio computador abre o endereço. Com `--rede`, outros aparelhos da casa também (o comando mostra os endereços).
- Só leitura, a não ser com `--editar` (abaixo): nada é gravado na biblioteca. Arquivos e pastas ocultos (`.originais`) não são servidos, e arquivos da biblioteca que não são vídeo, imagem ou texto vão como download, nunca como página.
- Só responde a endereços IP, `localhost` e o nome do próprio aparelho (como `raspberrypi.local`), contra páginas que tentam ler a rede de casa por outro nome (*DNS rebinding*).
- Leve: o app vai comprimido (o JavaScript, de ~430 KB, viaja como ~120 KB em Brotli, já comprimido na hora do build), e a lista da biblioteca vai em gzip. Vídeos e fontes não são comprimidos de novo: já são.

### Salvar canais pelo servidor (`--editar`)

Sem `--editar`, o servidor não grava nada. Com ela, o assistente "Montar a semana" salva o canal direto na biblioteca, de qualquer aparelho que abriu o endereço (a TV, o celular, outro PC):

```
tv-gominho servir ./biblioteca --rede --editar
...
Salvar canais pelo app: LIGADO. PIN para parear um aparelho: 482913
```

- Ao salvar pela primeira vez, o app pede o **PIN de 6 números** que aparece no terminal. Dá para digitar com os números do controle remoto ou com o teclado na tela (setas e OK). O aparelho fica pareado até o navegador fechar ou o servidor desligar; cada vez que o servidor liga, o PIN é outro.
- Só dá para gravar `grades/<nome>.yaml` (nome com letras, números, `-` e `_`) e `nao-passar.yaml`, na raiz da biblioteca (ou dentro de `biblioteca/`, se o servidor foi aberto na pasta acima dela). Nada mais: nem vídeos, nem configurações, nem outras pastas.
- A grade precisa ser uma grade válida (a mesma leitura do app), em UTF-8, com até 256 KB. A lista "não passar" precisa ser lida pelo app sem nenhum aviso (só `programas` e `episodios`, veja [biblioteca.md](biblioteca.md)).
- Nunca substitui um arquivo que já existe: o assistente sempre cria um canal novo. Quem quiser substituir (um editor, no futuro) precisa pedir explicitamente, com `?substituir=1` no endereço.
- Cada arquivo gravado aparece no terminal (`Gravado: grades/manha.yaml`).

Segurança:

- Desligado por padrão; só quem tem acesso ao terminal vê o PIN. O PIN é sorteado com gerador criptográfico.
- PIN errado 5 vezes seguidas trava o pareamento por 1 minuto, e cada nova trava dura o dobro (até 1 hora). O terminal avisa.
- O pareamento vira um cookie de sessão aleatório, `HttpOnly` e `SameSite=Strict`, que só vale enquanto o servidor estiver ligado.
- Toda gravação confere a origem do pedido (`Origin` igual ao endereço aberto), contra páginas de outros sites que tentem gravar pelo navegador de alguém da casa (CSRF), além da proteção de `Host` de sempre.
- O caminho é conferido como texto, sem decodificar: `..`, barras invertidas, `%2F` e afins são recusados. A pasta de destino, com atalhos (links) resolvidos, precisa ficar dentro da biblioteca.
- O arquivo é gravado num temporário oculto e renomeado no fim: ou fica o arquivo inteiro, ou nada.
- A conexão é HTTP sem criptografia, como o resto do `servir`: use `--editar` só na rede de casa.

Para quem integra (rotas, todas sob o mesmo endereço do app):

| Rota | O que faz |
|---|---|
| `GET /__tv-gominho/capacidades` | `{"editar": true/false, "pareado": true/false}` |
| `POST /__tv-gominho/pareamento` | JSON `{"pin": "123456"}` → 200 e o cookie; 403 PIN errado; 429 travado (`Retry-After`) |
| `PUT /__tv-gominho/arquivos/<caminho>` | corpo = o arquivo. 201 criado, 200 substituído, 401 sem pareamento, 403 origem, 400 caminho ou conteúdo inválido, 409 já existe, 413 grande demais |

## Pacote portátil

`npm run pacote` monta `pacote/tv-gominho/` (~1,2 MB): a ferramenta (um arquivo só, `tv-gominho.mjs`), o app compilado, atalhos para abrir (`Abrir TV Gominho.cmd` no Windows, `abrir-tv-gominho.sh`) e o instalador do Raspberry Pi. Coloque a pasta ao lado da `biblioteca` (num pendrive, por exemplo). O `interface/index.html` também abre direto do pendrive no Chrome ou no Edge, sem Node.js nem servidor.

## Para quem contribui

O código fica em `pacotes/cli/` e é compilado em um arquivo só com o Vite (modo SSR para Node), porque o Node roda TypeScript mas não resolve os imports sem extensão do núcleo. Cada comando é um módulo em `src/commands/` registrado em `src/commands/index.ts`. Os módulos reutilizáveis:

- `src/ffmpeg/`: localizar o ffmpeg (`locateFfmpeg`), analisar arquivos (`probe`) e rodar com progresso e cancelamento (`run`).
- `src/serve/`: o HTTP do `servir` (`http.ts`: arquivos com Range, lista, app comprimido) e a gravação com PIN de `--editar` (`edit.ts`), testada em `commands/servir.editar.test.ts`.
- `src/node-source.ts`: lê uma pasta do disco como biblioteca (`openNodeLibrary`), para usar com `scanLibrary`.
- `src/jev/client.ts`: cliente mínimo da API do Jev (TypeSafe), com `fetch`, novas tentativas e cache em disco; sem SDK, para a ferramenta continuar pequena.
- `src/organizar/`: o comando `organizar`. `questions.ts` (as perguntas ao Jev e por que têm esse formato), `classify.ts` (quem é perguntado e quando), `plan.ts` (para onde vai cada arquivo, sem rede nem disco, por isso testado sem o Jev). `avaliacao.test.ts` mede as perguntas contra o Jev de verdade com nomes de arquivo realistas: rode `npm run avaliar:jev` depois de mudar as perguntas ou os limites de confiança (gasta tokens, por isso o `npm test` pula).
- `src/convert/plan.ts`: decisões do conversor (converter, só trocar o contêiner ou pular) e argumentos do ffmpeg, sem nenhuma chamada ao ffmpeg, por isso testados sem ele.
- `src/pendrive/`: o comando `pendrive`. `rundown.ts` (dias, itens e trechos de episódio, com o motor do núcleo), `parts.ts` (divisão em partes de menos de 4 GB), `crt.ts` (o efeito CRT: máscara e filtros), `segment.ts` (argumentos do ffmpeg e chaves de cache de cada item), `render.ts` (renderizar, juntar, retomar), `settings.ts` (configurações da biblioteca + opções), `names.ts`, `readme.ts`, `copy.ts`, `dest.ts`. Tudo que não chama o ffmpeg é testado sem ele; `commands/pendrive.e2e.test.ts` renderiza de verdade (e é pulado se não houver ffmpeg).
