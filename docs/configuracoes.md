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
| `crt.curvatura` | número de 0 a 100 (ou `50%`) | `50` |
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

- **`continuo`** (padrão): a grade do dia se repete sem parar, 24 horas por dia. Você liga a qualquer hora e está passando algo, mas no meio do episódio, como numa TV ao vivo. Nos dias fora de `dias`, reprisa o último dia de exibição.
- **`real`**: segue o relógio de verdade.
  - Cada bloco começa no `horario` que a grade define. Espaços de até 10 minutos entre blocos são preenchidos com vinhetas e comerciais; espaços maiores ficam **fora do ar**. Um bloco que atrasa (porque o anterior passou do horário) começa atrasado, sem cortar nada, e não há fora do ar entre os dois.
  - Quando não há nada programado (antes do primeiro bloco, entre blocos distantes, depois do último item, ou o dia todo nos dias fora de `dias`), aparece uma tela de teste de cores com "Fora do ar" e a hora da volta: "Voltamos às 08:00", "Voltamos amanhã às 08:00" ou "Voltamos segunda-feira às 08:00". A volta é automática, na hora certa. Se o computador dormir ou a aba ficar em segundo plano, o relógio é conferido de novo ao acordar.
  - Meia-noite: um bloco nunca é cortado. Se a programação de ontem ainda está passando depois das 00:00 (até 6 horas depois), ela continua até acabar, mesmo que hoje seja folga; depois vale a grade de hoje. Os episódios continuam sendo os do dia em que o bloco começou.
  - Ao ligar no meio de um episódio, entra no ponto certo, como na TV ao vivo. Mudar de canal e voltar sempre mostra o que está no ar naquele momento.
- **`do_inicio`**: ao ligar o canal, sempre começa pela abertura do primeiro bloco (o primeiro item da grade), como uma maratona, e segue em ordem sem olhar o relógio. Os espaços entre blocos são pulados. Quando o último item do dia acaba, a maratona continua com o próximo dia de exibição da grade (assim os episódios avançam, em vez de repetir o mesmo dia): depois da sexta-feira vem a segunda. Se o dia em que você ligou é folga, começa pelo último dia de exibição.
  - **Mudar de canal e voltar:** a maratona continua de onde estaria, como se tivesse passado o tempo todo. O início de cada maratona fica guardado só enquanto a página estiver aberta: ao recarregar, ou ao trocar `horario` e voltar, ela recomeça pela abertura.

### `crt.curvatura`

Quanto a tela do tubo é abaulada, em porcentagem: `0` é uma tela perfeitamente reta (a imagem aparece inteira, sem cortes), `50` (padrão) é a curva de uma TV comum e `100` é bem arredondada, com cantos e bordas escuras mais fortes. Aceita `50` ou `"50%"`. Não depende de `crt.intensidade`. Valores fora de 0 a 100 geram um aviso e viram 0 ou 100. Por compatibilidade, `sim` vale o padrão (`50`) e `não` vale `0`. No menu, é uma barra: use ← → (de 10 em 10) ou arraste.

### `vinhetas` e `comerciais`

Valem de forma independente. `vinhetas: não` tira as vinhetas das grades e as de `intervalos` que preenchem os espaços entre blocos; `comerciais: não` tira os comerciais (itens `comerciais` da grade e os de `vinhetas/comerciais/`, inclusive no preenchimento). Os episódios e os horários dos blocos não mudam.

### Ainda não implementadas

`marca_dagua` e `idioma` ficam para mais adiante. Se aparecerem no arquivo, geram um aviso e são ignoradas.

## Exemplo de `configuracoes.yaml`

```yaml
horario: real
crt:
  intensidade: suave
  curvatura: 30
comerciais: false
```

Só é preciso escrever o que muda em relação ao padrão.
