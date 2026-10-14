# Configurações

Por padrão, tudo vem ligado para dar a experiência completa. As configurações podem ser mudadas no menu do app (navegável pelo controle remoto) ou no arquivo `biblioteca/configuracoes.yaml`, que define os padrões para quem usar aquela biblioteca.

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

### `canais_por_programa`

Cria um canal extra para cada programa da biblioteca, que passa só os episódios dele, um atrás do outro, com vinhetas de `intervalos` entre eles. Ficam depois dos canais das grades.

### `horario`

- **`continuo`** (padrão): a grade do dia se repete sem parar, 24 horas por dia. Você liga a qualquer hora e está passando algo, mas no meio do episódio, como numa TV ao vivo.
- **`real`**: segue o relógio de verdade. Fora dos horários da grade aparece uma tela de "fora do ar" com o horário da volta.
- **`do_inicio`**: sempre começa pela abertura do primeiro bloco, como uma maratona.

## Exemplo de `configuracoes.yaml`

```yaml
horario: real
crt:
  intensidade: suave
comerciais: false
```

Só é preciso escrever o que muda em relação ao padrão.
