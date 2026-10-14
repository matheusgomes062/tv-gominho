# Grade de programação

Uma grade descreve o que passa em cada horário, como a programação da TV Globinho de um determinado ano. Cada grade é um **canal** no Modo TV. Depois das grades vêm os **canais por programa** (um por programa, só com os episódios dele; veja `canais_por_programa` em [configuracoes.md](configuracoes.md)). Sem nenhuma grade, o app cria um "Canal Automático" com todos os programas.

## Exemplo

```yaml
nome: TV Globinho (2003)
descricao: Programação das manhãs de segunda a sexta.
data_inicio: 2003-03-03     # dia em que a grade "estreou" (define qual episódio passa em cada dia)
dias: [seg, ter, qua, qui, sex]

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

## Grades da comunidade

As grades históricas ficam em [`grades/`](../grades/) neste repositório, uma por arquivo (`globinho-2003.yaml`). Contribuições devem citar a fonte (guia de TV, jornal da época, gravação) na `descricao`.
