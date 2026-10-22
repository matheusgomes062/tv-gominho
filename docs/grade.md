# Grade de programação

Uma grade descreve o que passa em cada horário, como a programação da TV Globinho de um determinado ano. Cada grade é um **canal** no Modo TV. Depois das grades vêm os **canais por programa** (um por programa, só com os episódios dele; veja `canais_por_programa` em [configuracoes.md](configuracoes.md)). Sem nenhuma grade, o app cria um "Canal Automático" com todos os programas.

Não precisa escrever a grade à mão: `tv-gominho grade <biblioteca> --epoca 2004` monta uma no estilo da TV Globinho com os programas e as vinhetas da biblioteca (veja [ferramentas.md](ferramentas.md#grade)). Depois é só editar o arquivo, se quiser. Também dá para montar um canal pela tela, sem linha de comando: veja a seção abaixo.

## Montar a semana pelo app

No app, **Menu → Programação** abre o assistente "Montar a semana": uma sequência curta de passos que gera uma grade nova com o mesmo gerador do `tv-gominho grade` e a salva na biblioteca. Funciona com mouse, teclado e controle remoto (setas, OK e Voltar).

| Passo | O que você escolhe |
|---|---|
| 1. Horários | **Manhã** (08:00–12:00), **Tarde** (14:00–18:00), **Manhã e tarde**, ou **Faixas próprias**: até 3 faixas, com início e fim ajustados de 15 em 15 minutos (← → no valor, ou clique nas setas). As faixas não podem se sobrepor e cada uma termina depois de começar. |
| 2. Dias | Os dias da semana em que o canal passa, com atalhos "Segunda a sexta", "Fim de semana" e "Todos os dias". Pelo menos um dia. |
| 3. Programas | **Todos os programas** (o app escolhe a ordem do rodízio) ou **Escolher os programas**: você marca os que entram e a ordem do rodízio é a da marcação; com ← → no programa marcado ele passa para antes ou depois. Pelo menos um programa. |
| 4. Nome | Como o canal aparece na troca de canais. |
| 5. Salvar | Um resumo e o botão **Salvar canal**. |

Cada faixa de horário vira um bloco da grade, preenchido com os programas em rodízio, com abertura, chamadas e encerramento, como em `tv-gominho grade` (a marca padrão é a TV Globinho, sem época específica). Voltar (Esc) recua um passo; no primeiro, fecha o assistente.

**O assistente sempre cria um canal novo.** O nome do arquivo vem do nome do canal (letras, números e hífens: "Manhãs da Turma" vira `grades/manhas-da-turma.yaml`) e, se já existe, ganha `-2`, `-3`... Nenhum arquivo existente é trocado. Para mudar um canal que já existe, use o [editor de canal](#editar-um-canal-pelo-app) ou edite o arquivo (formato abaixo).

### Onde o canal é salvo

- **Chrome ou Edge, no PC, com a biblioteca aberta pelo botão "Escolher biblioteca"** (a pasta fica lembrada): ao tocar em **Salvar canal**, o navegador pede **permissão de escrita** na pasta. O app só pede isso nessa hora; a leitura continua como sempre. Dada a permissão, o arquivo é gravado em `grades/` (a pasta é criada se não existir; se a biblioteca está dentro de uma pasta `biblioteca`, vai para `biblioteca/grades/`). Em seguida a biblioteca é lida de novo e o canal já aparece na troca de canais, sem recarregar a página. A tela oferece **Assistir agora**.
- **Biblioteca servida por `tv-gominho servir --editar`** (a TV, o celular ou outro PC pela rede): na primeira vez, o app pede o PIN que aparece no terminal do computador (números do controle remoto ou o teclado na tela). Depois o arquivo é gravado em `grades/` pelo servidor e o canal já aparece na troca de canais. Veja [ferramentas.md](ferramentas.md#salvar-canais-pelo-servidor---editar).
- **Em qualquer outro caso** (Firefox, Safari, pasta aberta pelo campo de pasta comum, `tv-gominho servir` sem `--editar`, ou permissão negada): o app **baixa o arquivo** `.yaml` e mostra onde colocá-lo: dentro da pasta `grades/` da biblioteca (a mesma pasta, no pendrive e no Raspberry Pi). Depois é só abrir a biblioteca de novo para o canal aparecer.

Para os blocos fecharem perto do fim de cada faixa, o assistente lê a duração dos vídeos (o navegador lê os metadados dos arquivos, sem ffmpeg). Se isso demorar mais de 12 segundos numa biblioteca grande, valem as durações típicas (22 minutos por episódio) para o que faltou.

## Editar um canal pelo app

No PC, **Menu → Programação → Editar** (ao lado do nome do canal) abre o editor da grade, com mouse e teclado. Só as grades de verdade (os arquivos de `grades/`) podem ser editadas; o "Canal Automático" e os canais por programa não têm arquivo. O editor mostra os blocos e os itens como estão no arquivo e deixa:

- mudar o **nome**, a **descrição** e os **dias**;
- **acrescentar e remover blocos** e mudar o **horário** de cada um (`HH:MM`, como `08:00`). Dois blocos não podem começar no mesmo horário, e os blocos ficam sempre em ordem de horário;
- **acrescentar, remover e reordenar os itens** de um bloco (os botões ▲ ▼ ou Alt+↑ / Alt+↓): **programa** (qual e quantos episódios), **vinheta** (a categoria e, dentro dela, "sortear de toda a pasta", "sortear da pasta" de uma subpasta ou um arquivo específico) e **comerciais** (quantos).

Itens que não existem na biblioteca (um programa ou uma vinheta que sumiu) aparecem com o mesmo aviso que o app mostra em Avisos, e a grade continua podendo ser salva: o motor só pula o item. Já um horário inválido, dois blocos no mesmo horário, um bloco sem itens, uma quantidade que não seja um número inteiro de 1 a 99 ou um canal sem nome impedem de salvar, com o motivo na tela.

**Salvar não deixa nenhum programa pular.** Ao salvar, o app grava as [posições salvas](#posições-salvas) de hoje, para cada programa seguir do episódio em que estava (isso só é preciso quando a edição muda o que passa: itens ou dias; mudar só o nome, a descrição ou um horário não grava posições). O que o editor não mexe é mantido como estava: `data_inicio`, `vinhetas_intervalo`, `intervalos`, as `posicoes` que já existiam e a `agenda`. A agenda acompanha os itens: se você reordena itens ou muda o horário de um bloco, cada escolha continua no mesmo programa; se o item, o bloco ou o dia saiu do canal, ou o item passou a ser outro programa, aquela escolha é descartada (o app avisa quantas ao salvar).

Salvar **troca o arquivo da grade** (`grades/<canal>.yaml`) pelo texto novo, sem pedir uma segunda confirmação; faça uma cópia do arquivo antes se quiser guardar a versão antiga. O arquivo é reescrito pelo app: **os comentários que você escreveu nele não são mantidos** (o app põe só uma linha de comentário no topo), mas o conteúdo, sim. Fica igual ao formato deste documento.

Onde grava é como no assistente: no Chrome ou no Edge, com a biblioteca aberta por "Escolher biblioteca", o navegador pede permissão de escrita na pasta quando você salva (Ctrl+S também salva) e o canal novo já vale na troca de canais, sem reiniciar. Nos outros casos (Firefox, Safari, pasta aberta pelo campo de pasta comum, biblioteca servida por `tv-gominho servir`, com ou sem `--editar`, ou permissão negada), o app **baixa o arquivo** com o mesmo nome e mostra onde colocá-lo: por cima do arquivo antigo em `grades/`.

## Exemplo

```yaml
nome: TV Gominho (2003)
descricao: Programação das manhãs de segunda a sexta.
data_inicio: 2003-03-03     # dia em que a grade "estreou" (define qual episódio passa em cada dia)
dias: [seg, ter, qua, qui, sex]
vinhetas_intervalo: intervalos/tv-globinho   # opcional: de qual canal vêm as vinhetas dos intervalos

blocos:
  - horario: "08:00"
    itens:
      - vinheta: aberturas
      - programa: dragon-ball-z
      - vinheta: intervalos
      - comerciais: 3           # 3 comerciais sorteados
      - programa: bob-esponja
        episodios: 2            # dois episódios seguidos
      - vinheta: encerramentos

  - horario: "10:30"
    itens:
      - vinheta: aberturas/2003
      - programa: digimon
```

## Itens

| Item | Significado |
|---|---|
| `programa: <pasta>` | Próximo(s) episódio(s) do programa. `episodios: N` define quantos (padrão: 1). |
| `vinheta: <categoria>[/subpasta]` | Uma vinheta sorteada da categoria ou da subpasta. |
| `vinheta: <categoria>/<arquivo>` | Uma vinheta específica. |
| `comerciais: N` | N comerciais sorteados de `vinhetas/comerciais`. |

## Chaves da grade

| Chave | Significado |
|---|---|
| `nome` | Nome do canal (padrão: o nome do arquivo). |
| `descricao` | Texto livre. |
| `data_inicio` | Dia da estreia; define qual episódio passa em cada dia. |
| `dias` | Dias da semana em que a grade passa (padrão: todos). |
| `vinhetas_intervalo` | Opcional. De onde vêm as vinhetas que abrem e fecham os intervalos comerciais (veja "Intervalos comerciais" abaixo). |
| `intervalos` | Opcional. Regras de intervalo só deste canal, com os mesmos nomes da configuração geral (veja "Intervalos por canal" abaixo). |
| `agenda` | Opcional. Episódios escolhidos à mão para datas específicas (veja "Agenda" abaixo). |
| `posicoes` | Opcional. Em que episódio cada programa estava numa data; o app grava ao editar o canal (veja "Posições salvas" abaixo). |
| `blocos` | Os blocos de horário, com seus itens. |

## Regras do motor

1. **Os blocos começam no horário definido.** Se os itens de um bloco terminam até 10 minutos antes do próximo bloco, o espaço é preenchido com vinhetas de `intervalos` e `comerciais` (se estiverem ligados); o que sobrar vira chuvisco. Espaços maiores são pulados e o próximo bloco começa logo em seguida, para o canal estar sempre no ar (`horario: continuo`, o padrão, e `do_inicio`, que pula todos os espaços). Só com `horario: real` os espaços grandes são respeitados: o canal fica fora do ar até o próximo bloco.
2. **Atrasos:** se um bloco passa do horário do próximo, o episódio não é cortado e o próximo bloco começa atrasado, como na TV de verdade. Isso vale em todos os modos de `horario`, inclusive no `real`: o bloco seguinte entra assim que o atrasado termina, sem tela de fora do ar no meio.
3. **Qual episódio passa:** cada exibição de um programa avança um episódio. O motor conta quantas vezes o programa já foi exibido desde `data_inicio` e escolhe o episódio por essa conta. Ao chegar ao fim, volta ao primeiro. Isso não depende de estado salvo, então dois aparelhos mostram o mesmo episódio. Um episódio escolhido na [agenda](#agenda) ou uma [posição salva](#posições-salvas) muda o ponto de partida dessa conta. Episódios da lista [não passar](biblioteca.md#não-passar-nao-passaryaml) ficam de fora dessa conta: a sequência anda só pelos episódios permitidos (e o sorteio não os escolhe). Um programa inteiro na lista é pulado com aviso, como na regra 6.
4. **Sorteios** (vinhetas, comerciais, programas com `ordem: aleatoria`) usam uma semente baseada na data. São variados, mas reproduzíveis.
5. **Dias fora de `dias`** (por exemplo, sábado e domingo numa grade de segunda a sexta). O comportamento depende da configuração `horario` (veja [configuracoes.md](configuracoes.md)):
   - `continuo` (padrão): o canal reprisa o último dia de exibição (a sexta-feira), então sempre há algo no ar.
   - `real`: o canal fica **fora do ar o dia todo**, com a mensagem "Voltamos segunda-feira às 08:00" (o próximo dia da grade, no horário do primeiro bloco). A única exceção é a sobra da madrugada (regra 7).
   - `do_inicio`: o relógio e os dias não importam. Se você ligar num dia fora da grade, a maratona começa pelo último dia de exibição e segue pelos próximos dias da grade.

   Só os dias de `dias` avançam a contagem de episódios (regra 3); os dias de folga não gastam episódios.
6. **Itens que faltam:** se um programa ou uma vinheta não existe na biblioteca, o item é pulado e um aviso aparece nas configurações. A grade nunca trava.
7. **Blocos que passam da meia-noite** (só importa em `horario: real`): um bloco nunca é cortado à meia-noite. Se a programação de um dia ainda está passando depois das 00:00 (por exemplo, um bloco que começa às 23:00 e termina à 01:00), ela continua até acabar, mesmo que o dia novo seja folga, e só então vale a grade do dia novo. Essa sobra é considerada até 6 horas depois da meia-noite.

## Agenda

Por padrão o motor escolhe os episódios sozinho (regra 3). Com a seção opcional `agenda`, você escolhe **o episódio de um programa numa data**; todo o resto continua automático.

```yaml
agenda:
  2003-03-05:                  # a data (AAAA-MM-DD), entre os dias da grade
    - bloco: "08:00"           # o "horario" do bloco, entre aspas
      item: 2                  # a posição do item no bloco, contando de 1: o 2º item do bloco das 08:00
      episodio: 12             # o episódio que passa
    - bloco: "10:30"
      item: 2                  # o digimon (o item 1 desse bloco é a vinheta)
      episodio: temporada-02/3 # com temporadas repetindo números, a pasta da temporada antes do número
  2003-03-10:
    - bloco: "08:00"
      item: 2
      episodio: 1
```

- **Qual item:** o bloco é identificado pelo `horario` e o item pela posição dele na lista `itens` (a vinheta de abertura conta como item 1, por exemplo). O item precisa ser um `programa`. Se ele tem `episodios: 2`, o episódio escolhido é o primeiro dos dois e o outro vem logo depois dele.
- **Qual episódio:** o número que está no começo do nome do arquivo (`012 - Título.mp4` é o `12`), o mesmo das chaves de `episodios.yaml` (veja [biblioteca.md](biblioteca.md)). Se o programa tem temporadas e o número se repete (`temporada-01/001` e `temporada-02/001`), escreva também a temporada: `temporada-02/1`.
- **Continuação:** depois do episódio escolhido, as próximas exibições do programa seguem a partir do episódio **seguinte** a ele (pulando os da lista [não passar](biblioteca.md#não-passar-nao-passaryaml)), e voltam ao primeiro no fim, como sempre. No exemplo, se o `dragon-ball-z` passa uma vez por dia, a quinta-feira 2003-03-06 passa o episódio 13. Com mais de uma escolha para o mesmo programa, vale sempre a mais recente que já passou. Escolhas não mudam o que passou *antes* da data delas.
- **Lista "não passar":** um episódio escolhido na agenda passa mesmo estando em `nao-passar.yaml`.
- **Programas com `ordem: aleatoria`** passam o episódio escolhido na data dele; nos outros dias continuam sorteando.
- **Dias fora da grade:** a data tem que ser um dos `dias` da grade. Num dia de folga que repete o último dia de exibição (`horario: continuo`), a repetição traz também a escolha.
- **Tudo vale em todos os aparelhos e no `tv-gominho pendrive`**, em todos os modos de `horario`, porque só depende do arquivo.
- **Erros não travam a grade:** data inválida, bloco ou item que não existe, item que não é um programa, episódio que o programa não tem (ou que existe em mais de uma temporada) geram um aviso e a escolha é ignorada. A grade sem `agenda` passa exatamente como antes.

## Posições salvas

Mudar os blocos de um canal (mais ou menos exibições de um programa por dia, outra ordem) muda a conta da regra 3 e os episódios pulariam ou voltariam ao começo. Para isso não acontecer, **quando você edita um canal que já existia, o app grava a seção `posicoes`**: para cada programa, o episódio com que ele começa o dia da edição. Dali em diante cada exibição avança um episódio, como sempre. **Você raramente escreve esta seção à mão**; ela existe para o app e para quem quiser ler ou ajustar o arquivo.

```yaml
posicoes:
  2026-10-22:            # a data (AAAA-MM-DD), entre os dias da grade
    dragon-ball-z: 13    # a pasta do programa e o episódio com que ele começa esse dia
    digimon: temporada-02/3
```

- **Qual episódio:** o mesmo formato da [agenda](#agenda): o número do arquivo (`13`) ou `temporada-02/3` quando o número se repete entre temporadas.
- **Continuação:** na data, a **primeira exibição do dia** do programa é esse episódio, e as seguintes avançam a partir dele (voltando ao primeiro no fim). Valem sempre a âncora mais recente que já passou, seja uma posição salva ou uma escolha da [agenda](#agenda); não muda o que passou *antes* da data.
- **A escolha à mão vence:** se a agenda escolhe um episódio do programa na mesma data, vale a agenda. Uma posição mais antiga que uma escolha da agenda perde para ela, e uma posição mais nova que a escolha perde a escolha, como entre duas escolhas.
- **Lista "não passar":** uma posição não é uma escolha à mão. Se o episódio salvo entrou em [`nao-passar.yaml`](biblioteca.md#não-passar-nao-passaryaml), o programa começa o dia pelo próximo episódio permitido e segue dali. O app grava a posição com a lista antiga e o canal continua sem pulos quando a lista muda.
- **O que o app grava:** o episódio que o canal *antigo* passaria primeiro naquele dia (com a agenda e as posições antigas valendo). Programas que só existem na grade nova não ganham posição (começam pela conta normal), e programas com `ordem: aleatoria` também não, porque sorteiam. Se o dia da edição não é um dia da grade, vale o próximo dia da grade. As posições mais antigas dos mesmos programas saem do arquivo (a nova as substitui daquela data em diante), o que mantém o arquivo curto; a agenda fica como está.
- **Erros não travam a grade:** data inválida ou fora dos `dias`, programa que não está nos blocos, episódio inválido, que o programa não tem ou que existe em mais de uma temporada geram um aviso e a posição é ignorada. Uma grade sem `posicoes` passa exatamente como antes.
- Vale em todos os aparelhos, em todos os modos de `horario` e no `tv-gominho pendrive`, porque só depende do arquivo.

## Intervalos comerciais

Como na TV de verdade, os episódios não passam direto: o motor insere **intervalos comerciais** de `vinhetas/comerciais/`, sem que você precise escrever nada na grade. (Não existem mais as vinhetas de "a seguir" entre os episódios: quem separa os programas são os comerciais.) Tudo é ajustável com o bloco `intervalos` da [configuração](configuracoes.md) e só acontece com `comerciais` ligado (e com comerciais na biblioteca): com `comerciais: não`, os episódios passam inteiros.

- **No meio do episódio:** a cada `a_cada` minutos (padrão 8) de episódio há um intervalo, como nos "atos" dos desenhos (a Nickelodeon, por exemplo, dividia o programa de meia hora em dois atos de uns 11 minutos). Um episódio de duração D tem `n = piso(D / (a_cada × 60))` intervalos, **distribuídos igualmente** (n + 1 atos do mesmo tamanho). Nenhum intervalo cai a menos de 2 minutos do começo ou do fim do episódio, nem a menos de 2 minutos de outro intervalo; episódios menores que `a_cada` + 2 minutos não são cortados. `a_cada: 0` desliga os intervalos no meio. Exemplo, com os padrões: um episódio de 22 minutos tem dois intervalos, aos 7:20 e aos 14:40.
- **Pontos exatos:** um episódio pode dizer onde quer ser cortado (por exemplo, nos fades para preto do próprio vídeo) com `intervalos` no `episodios.yaml` (veja [biblioteca.md](biblioteca.md)). Esses pontos valem no lugar da divisão igual (mas não com `a_cada: 0`).
- **Depois do episódio:** quando `apos_episodio` está ligado (padrão), todo episódio termina com um intervalo de `comerciais` comerciais (padrão 3), antes do que vier a seguir. Se o item seguinte da grade já é um `comerciais: N` (ou uma `vinheta` da categoria `comerciais`), o motor não duplica: vale o que a grade escreveu.
- **Quais comerciais:** são sorteados com a mesma semente do dia dos outros sorteios (reproduzível entre aparelhos), sem repetir um comercial dentro do mesmo intervalo e passando primeiro pelos que não passaram no intervalo anterior.
- **O tempo conta:** os intervalos entram na linha do tempo, então um bloco com intervalos dura mais que a soma dos episódios (e o preenchimento de espaços entre blocos, a regra 1, usa só o que sobrar). O episódio continua a partir do ponto em que parou, no mesmo arquivo.
- **Vinhetas de intervalo:** com `intervalos.vinhetas` ligado (padrão), cada intervalo começa com uma vinheta de **entrada** ("TV Globinho volta já") e termina com uma de **saída** ("estamos de volta"), tiradas de `vinhetas/intervalos/` (nomes e pastas em [biblioteca.md](biblioteca.md)). Os dois lados de um intervalo vêm sempre da mesma marca (subpasta). Se a grade não diz nada, o motor sorteia uma marca **por dia**, com a semente do dia (igual em todo aparelho e durante o dia todo, então o canal parece uma emissora só naquele dia). Com `vinhetas_intervalo`, a grade escolhe a marca, na mesma sintaxe dos itens `vinheta`: uma categoria (`intervalos`, que volta a sortear uma subpasta por dia), uma subpasta (`intervalos/tv-globinho`) ou um arquivo (`intervalos/tv-globinho/entrada-01.mp4`, que só serve ao lado que o nome indica). Se o caminho não existe, aparece um aviso em Avisos e vale o sorteio diário. Sem vinheta de entrada (ou de saída) na marca, aquele lado do intervalo fica sem vinheta. As vinhetas contam no tempo do dia como os comerciais e só passam quando o intervalo acontece. O "Canal Automático" e os canais por programa também as usam, sempre com o sorteio diário.
- **Vinhetas escritas na grade** (`vinheta: intervalos`, `encerramentos`...) continuam passando onde você escreveu: a grade é sua. O "Canal Automático" e os canais por programa não colocam mais vinhetas de intervalo entre os episódios; quem faz isso são os comerciais.

### Intervalos por canal

Uma grade pode ter as próprias regras de intervalo, com o bloco opcional `intervalos` e os mesmos nomes do [bloco geral](configuracoes.md): `a_cada`, `comerciais`, `apos_episodio` e `vinhetas`.

```yaml
intervalos:
  a_cada: 11            # só este canal: um intervalo a cada 11 minutos de episódio
  comerciais: 2         # e 2 comerciais por intervalo
                        # apos_episodio e vinhetas não aparecem: valem os da configuração geral
```

- **O que a grade não escreve vem da configuração geral** (`configuracoes.yaml` e o que foi escolhido no menu). Outras grades da mesma biblioteca, sem `intervalos`, seguem as regras gerais.
- **O interruptor geral `comerciais` vence.** O canal só muda *como* os intervalos são, nunca *se* há comerciais: com `comerciais: não` na configuração geral, ou no menu, nenhuma grade liga comerciais. `vinhetas: não` geral também continua tirando as vinhetas de intervalo.
- **Valores inválidos** (texto onde se espera número, "talvez" no lugar de sim/não, opção desconhecida) geram um aviso em Avisos e são ignorados, e a regra volta a ser a geral. Números fora dos limites viram o limite mais próximo, como na configuração geral.
- Vale no app e no `tv-gominho pendrive`.

## Grades da comunidade

As grades históricas ficam em [`grades/`](../grades/) neste repositório, uma por arquivo (`gominho-2003.yaml`). Contribuições devem citar a fonte (guia de TV, jornal da época, gravação) na `descricao`.
