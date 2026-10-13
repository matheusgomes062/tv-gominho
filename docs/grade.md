# Grade de programação

Uma grade descreve o que passa em cada horário, como a programação da TV Globinho de um determinado ano. Cada grade é um **canal** no Modo TV.

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

1. **Os blocos começam no horário definido.** Se os itens de um bloco terminam até 10 minutos antes do próximo bloco, o espaço é preenchido com vinhetas de `intervalos` e `comerciais` (se estiverem ligados); o que sobrar vira chuvisco. Com `horario: continuo` (padrão), espaços maiores são pulados e o próximo bloco começa logo em seguida, para o canal estar sempre no ar.
2. **Atrasos:** se um bloco passa do horário do próximo, o episódio não é cortado e o próximo bloco começa atrasado, como na TV de verdade.
3. **Qual episódio passa:** cada exibição de um programa avança um episódio. O motor conta quantas vezes o programa já foi exibido desde `data_inicio` e escolhe o episódio por essa conta. Ao chegar ao fim, volta ao primeiro. Isso não depende de estado salvo, então dois aparelhos mostram o mesmo episódio.
4. **Sorteios** (vinhetas, comerciais, programas com `ordem: aleatoria`) usam uma semente baseada na data. São variados, mas reproduzíveis.
5. **Dias fora de `dias`:** comportamento definido pela configuração `horario` (veja [configuracoes.md](configuracoes.md)).
6. **Itens que faltam:** se um programa ou uma vinheta não existe na biblioteca, o item é pulado e um aviso aparece nas configurações. A grade nunca trava.

## Grades da comunidade

As grades históricas ficam em [`grades/`](../grades/) neste repositório, uma por arquivo (`globinho-2003.yaml`). Contribuições devem citar a fonte (guia de TV, jornal da época, gravação) na `descricao`.
