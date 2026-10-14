# Configurações

Por padrão, tudo vem ligado para dar a experiência completa. As configurações podem ser mudadas no menu do app (navegável pelo controle remoto) ou no arquivo `biblioteca/configuracoes.yaml`, que define os padrões para quem usar aquela biblioteca.

### Como as camadas se combinam

Cada configuração vale na seguinte ordem, da mais fraca para a mais forte:

1. **Padrão** do aplicativo (a coluna "Padrão" abaixo).
2. **`biblioteca/configuracoes.yaml`**, se existir: só o que estiver escrito ali muda em relação ao padrão.
3. **Escolhas feitas no menu** (Menu → Configurações): ficam salvas no navegador, uma lista separada para cada biblioteca. O botão "Restaurar padrões" apaga essas escolhas e volta ao que a biblioteca define.

No menu, cada opção mostra se o valor veio da biblioteca ou se foi alterado por você. Valores inválidos no arquivo geram um aviso (Menu → Avisos) e a opção volta ao padrão.

No pendrive comum, as mesmas configurações são escolhidas na hora de gerar o pendrive (veja [pendrive.md](pendrive.md)).

## Lista

| Configuração | Opções | Padrão |
|---|---|---|
| `modo_inicial` | `tv`, `biblioteca` | `tv` |
| `canal_inicial` | nome de uma grade | a primeira grade |
| `canais_por_programa` | sim/não | sim |
| `horario` | `continuo`, `real`, `do_inicio` | `continuo` |
| `crt.ligado` | sim/não | sim |
| `crt.intensidade` | `suave`, `media`, `forte` | `media` |
| `crt.curvatura` | sim/não | sim |
| `crt.linhas` (scanlines) | sim/não | sim |
| `chuvisco_troca_canal` | sim/não | sim |
| `proporcao` | `4:3`, `esticar`, `original` | `4:3` |
| `vinhetas` | sim/não | sim |
| `comerciais` | sim/não | sim |
| `relogio_na_tela` | sim/não | não |
| `marca_dagua` | caminho de uma imagem do usuário | nenhuma |
| `idioma` | `pt-BR`, `en` | `pt-BR` |

### `canal_inicial`

O canal que abre na primeira vez, indicado pelo nome da grade (ou pelo nome do arquivo dela). Se o navegador já lembra do último canal assistido, esse canal vence: `canal_inicial` só vale quando ainda não há um canal salvo.

### `canais_por_programa`

Cria um canal extra para cada programa da biblioteca, que passa só os episódios dele, um atrás do outro, com vinhetas de `intervalos` entre eles. Ficam depois dos canais das grades.

### `horario`

- **`continuo`** (padrão): a grade do dia se repete sem parar, 24 horas por dia. Você liga a qualquer hora e está passando algo, mas no meio do episódio, como numa TV ao vivo.
- **`real`**: segue o relógio de verdade. Fora dos horários da grade aparece uma tela de "fora do ar" com o horário da volta.
- **`do_inicio`**: sempre começa pela abertura do primeiro bloco, como uma maratona.

### `vinhetas` e `comerciais`

Valem de forma independente. `vinhetas: não` tira as vinhetas das grades e as de `intervalos` que preenchem os espaços entre blocos; `comerciais: não` tira os comerciais (itens `comerciais` da grade e os de `vinhetas/comerciais/`, inclusive no preenchimento). Os episódios e os horários dos blocos não mudam.

### Ainda não implementadas

`marca_dagua` e `idioma` ficam para mais adiante. Se aparecerem no arquivo, geram um aviso e são ignoradas.

## Exemplo de `configuracoes.yaml`

```yaml
horario: real
crt:
  intensidade: suave
comerciais: false
```

Só é preciso escrever o que muda em relação ao padrão.
