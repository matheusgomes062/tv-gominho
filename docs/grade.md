# Grade de programação

Uma grade descreve o que passa em cada horário, como a programação da TV Globinho de um determinado ano. Cada grade é um **canal** no Modo TV. Depois das grades vêm os **canais por programa** (um por programa, só com os episódios dele; veja `canais_por_programa` em [configuracoes.md](configuracoes.md)). Sem nenhuma grade, o app cria um "Canal Automático" com todos os programas.

Não precisa escrever a grade à mão: `tv-gominho grade <biblioteca> --epoca 2004` monta uma no estilo da TV Globinho com os programas e as vinhetas da biblioteca (veja [ferramentas.md](ferramentas.md#grade)). Depois é só editar o arquivo, se quiser.

## Exemplo

```yaml
nome: TV Globinho (2003)
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
| `blocos` | Os blocos de horário, com seus itens. |

## Regras do motor

1. **Os blocos começam no horário definido.** Se os itens de um bloco terminam até 10 minutos antes do próximo bloco, o espaço é preenchido com vinhetas de `intervalos` e `comerciais` (se estiverem ligados); o que sobrar vira chuvisco. Espaços maiores são pulados e o próximo bloco começa logo em seguida, para o canal estar sempre no ar (`horario: continuo`, o padrão, e `do_inicio`, que pula todos os espaços). Só com `horario: real` os espaços grandes são respeitados: o canal fica fora do ar até o próximo bloco.
2. **Atrasos:** se um bloco passa do horário do próximo, o episódio não é cortado e o próximo bloco começa atrasado, como na TV de verdade. Isso vale em todos os modos de `horario`, inclusive no `real`: o bloco seguinte entra assim que o atrasado termina, sem tela de fora do ar no meio.
3. **Qual episódio passa:** cada exibição de um programa avança um episódio. O motor conta quantas vezes o programa já foi exibido desde `data_inicio` e escolhe o episódio por essa conta. Ao chegar ao fim, volta ao primeiro. Isso não depende de estado salvo, então dois aparelhos mostram o mesmo episódio.
4. **Sorteios** (vinhetas, comerciais, programas com `ordem: aleatoria`) usam uma semente baseada na data. São variados, mas reproduzíveis.
5. **Dias fora de `dias`** (por exemplo, sábado e domingo numa grade de segunda a sexta). O comportamento depende da configuração `horario` (veja [configuracoes.md](configuracoes.md)):
   - `continuo` (padrão): o canal reprisa o último dia de exibição (a sexta-feira), então sempre há algo no ar.
   - `real`: o canal fica **fora do ar o dia todo**, com a mensagem "Voltamos segunda-feira às 08:00" (o próximo dia da grade, no horário do primeiro bloco). A única exceção é a sobra da madrugada (regra 7).
   - `do_inicio`: o relógio e os dias não importam. Se você ligar num dia fora da grade, a maratona começa pelo último dia de exibição e segue pelos próximos dias da grade.

   Só os dias de `dias` avançam a contagem de episódios (regra 3); os dias de folga não gastam episódios.
6. **Itens que faltam:** se um programa ou uma vinheta não existe na biblioteca, o item é pulado e um aviso aparece nas configurações. A grade nunca trava.
7. **Blocos que passam da meia-noite** (só importa em `horario: real`): um bloco nunca é cortado à meia-noite. Se a programação de um dia ainda está passando depois das 00:00 (por exemplo, um bloco que começa às 23:00 e termina à 01:00), ela continua até acabar, mesmo que o dia novo seja folga, e só então vale a grade do dia novo. Essa sobra é considerada até 6 horas depois da meia-noite.

## Intervalos comerciais

Como na TV de verdade, os episódios não passam direto: o motor insere **intervalos comerciais** de `vinhetas/comerciais/`, sem que você precise escrever nada na grade. (Não existem mais as vinhetas de "a seguir" entre os episódios: quem separa os programas são os comerciais.) Tudo é ajustável com o bloco `intervalos` da [configuração](configuracoes.md) e só acontece com `comerciais` ligado (e com comerciais na biblioteca): com `comerciais: não`, os episódios passam inteiros.

- **No meio do episódio:** a cada `a_cada` minutos (padrão 8) de episódio há um intervalo, como nos "atos" dos desenhos (a Nickelodeon, por exemplo, dividia o programa de meia hora em dois atos de uns 11 minutos). Um episódio de duração D tem `n = piso(D / (a_cada × 60))` intervalos, **distribuídos igualmente** (n + 1 atos do mesmo tamanho). Nenhum intervalo cai a menos de 2 minutos do começo ou do fim do episódio, nem a menos de 2 minutos de outro intervalo; episódios menores que `a_cada` + 2 minutos não são cortados. `a_cada: 0` desliga os intervalos no meio. Exemplo, com os padrões: um episódio de 22 minutos tem dois intervalos, aos 7:20 e aos 14:40.
- **Pontos exatos:** um episódio pode dizer onde quer ser cortado (por exemplo, nos fades para preto do próprio vídeo) com `intervalos` no `episodios.yaml` (veja [biblioteca.md](biblioteca.md)). Esses pontos valem no lugar da divisão igual (mas não com `a_cada: 0`).
- **Depois do episódio:** quando `apos_episodio` está ligado (padrão), todo episódio termina com um intervalo de `comerciais` comerciais (padrão 3), antes do que vier a seguir. Se o item seguinte da grade já é um `comerciais: N` (ou uma `vinheta` da categoria `comerciais`), o motor não duplica: vale o que a grade escreveu.
- **Quais comerciais:** são sorteados com a mesma semente do dia dos outros sorteios (reproduzível entre aparelhos), sem repetir um comercial dentro do mesmo intervalo e passando primeiro pelos que não passaram no intervalo anterior.
- **O tempo conta:** os intervalos entram na linha do tempo, então um bloco com intervalos dura mais que a soma dos episódios (e o preenchimento de espaços entre blocos, a regra 1, usa só o que sobrar). O episódio continua a partir do ponto em que parou, no mesmo arquivo.
- **Vinhetas de intervalo:** com `intervalos.vinhetas` ligado (padrão), cada intervalo começa com uma vinheta de **entrada** ("TV Globinho volta já") e termina com uma de **saída** ("estamos de volta"), tiradas de `vinhetas/intervalos/` (nomes e pastas em [biblioteca.md](biblioteca.md)). Os dois lados de um intervalo vêm sempre da mesma marca (subpasta). Se a grade não diz nada, o motor sorteia uma marca **por dia**, com a semente do dia (igual em todo aparelho e durante o dia todo, então o canal parece uma emissora só naquele dia). Com `vinhetas_intervalo`, a grade escolhe a marca, na mesma sintaxe dos itens `vinheta`: uma categoria (`intervalos`, que volta a sortear uma subpasta por dia), uma subpasta (`intervalos/tv-globinho`) ou um arquivo (`intervalos/tv-globinho/entrada-01.mp4`, que só serve ao lado que o nome indica). Se o caminho não existe, aparece um aviso em Avisos e vale o sorteio diário. Sem vinheta de entrada (ou de saída) na marca, aquele lado do intervalo fica sem vinheta. As vinhetas contam no tempo do dia como os comerciais e só passam quando o intervalo acontece. O "Canal Automático" e os canais por programa também as usam, sempre com o sorteio diário.
- **Vinhetas escritas na grade** (`vinheta: intervalos`, `encerramentos`...) continuam passando onde você escreveu: a grade é sua. O "Canal Automático" e os canais por programa não colocam mais vinhetas de intervalo entre os episódios; quem faz isso são os comerciais.

## Grades da comunidade

As grades históricas ficam em [`grades/`](../grades/) neste repositório, uma por arquivo (`globinho-2003.yaml`). Contribuições devem citar a fonte (guia de TV, jornal da época, gravação) na `descricao`.
