# Configurações

Por padrão, tudo vem ligado para dar a experiência completa. As configurações podem ser mudadas no menu do app (navegável pelo controle remoto) ou no arquivo `biblioteca/configuracoes.yaml`, que define os padrões para quem usar aquela biblioteca.

### Como as camadas se combinam

Cada configuração vale na seguinte ordem, da mais fraca para a mais forte:

1. **Padrão** do aplicativo (a coluna "Padrão" abaixo).
2. **`biblioteca/configuracoes.yaml`**, se existir: só o que estiver escrito ali muda em relação ao padrão.
3. **Escolhas feitas no app** (ajustes rápidos ou Menu → Configurações): ficam salvas no navegador, uma lista separada para cada biblioteca. O botão "Restaurar padrões" apaga essas escolhas e volta ao que a biblioteca define.

No painel de configurações, cada opção mostra se o valor veio da biblioteca ou se foi alterado por você. Valores inválidos no arquivo geram um aviso (Menu → Avisos) e a opção volta ao padrão.

No pendrive comum, as mesmas configurações são escolhidas na hora de gerar o pendrive (veja [pendrive.md](pendrive.md)).

## Painéis sobre a imagem

Menu, ajustes rápidos e configurações são painéis translúcidos **por cima da TV**, que continua passando (com som) por baixo. Tudo o que você muda vale na hora, então dá para ver o efeito do CRT, da curvatura ou da proporção enquanto ajusta. Os painéis são controlados só com as setas, OK e Voltar.

| Tecla | O que faz |
|---|---|
| Esc / Backspace / Voltar (na TV) | Abre o **menu**: canais, Biblioteca, Ajustes rápidos, Configurações, Avisos, Trocar pasta |
| `S`, `←` ou `→` (na TV; `S` também no player) | Abre os **ajustes rápidos** |
| Esc / Voltar (num painel) | Fecha um nível: lista de valores, depois o painel, depois o painel de baixo (por exemplo, configurações → menu → TV) |

Enquanto um painel está aberto, ↑ ↓ ← → e Enter só mexem nele: o canal não muda e o foco não sai do painel. Clicar fora do painel também o fecha.

**Ajustes rápidos** (barra na parte de baixo da tela, como nas TVs Samsung): uma fileira de blocos, cada um com o nome e o valor atual da opção: Tema, Efeito CRT, Curvatura, Proporção, Horário, Comerciais e Relógio, e no fim "Todas as configurações". ← → escolhem o bloco; ↑ ↓ mudam o valor (na curvatura, ↑ aumenta de 10 em 10); OK liga/desliga, ou mostra a lista de valores quando há vários.

**Configurações** (painel à esquerda): categorias Tema, Imagem, Programação, Canais, Intervalos comerciais e Sobre e restaurar. ↑ ↓ escolhem a categoria; → ou OK entram nas opções, onde ← → mudam o valor (interruptores: ← desliga, → liga; barras: ← → mexem um passo, ou arraste com o mouse) e Voltar retorna às categorias. "Restaurar padrões" fica em Sobre e restaurar.

## Temas (`tema`)

Um tema é um **conjunto de ajustes prontos** mais o **estilo dos textos na tela** (número do canal, barra de informações, relógio e tela de "fora do ar"):

| `tema` | Nome no app | CRT | Curvatura | Proporção | Chuvisco | Textos na tela |
|---|---|---|---|---|---|---|
| `tv_antiga` (padrão) | TV antiga | ligado, média, linhas | 50 | 4:3 | sim | verdes, em fonte de pixels grossos, de TV de tubo dos anos 90 |
| `vhs` | Fita VHS | ligado, forte, linhas | 15 | 4:3 | sim | brancos, em maiúsculas quadradas de videocassete, com "PLAY ▶", contador e uma leve tremida |
| `tv_moderna` | TV moderna | desligado | 0 | original | não (tela preta) | limpos, em fonte sem serifa parecida com a das TVs Samsung, em cápsulas arredondadas |
| `personalizado` | Personalizado | os que você escolheu | | | | os do último tema |

Como o tema se combina com as outras opções:

- Escolher um tema no app grava os valores dele como **escolhas suas** (CRT, curvatura, proporção, chuvisco) e troca o estilo dos textos. O restante (relógio, horário, comerciais…) não muda.
- Depois disso, mudar qualquer ajuste que o tema define (CRT, intensidade, curvatura, linhas, proporção, chuvisco ou o estilo dos textos) troca o tema para **Personalizado**, que continua com o estilo de textos do último tema. Escolher um tema de novo reaplica o conjunto inteiro.
- No `configuracoes.yaml`, `tema: vhs` vale como os ajustes do tema como padrão da biblioteca. O que o arquivo disser explicitamente (por exemplo, `proporcao: 4:3` junto de `tema: tv_moderna`) vale mais que o tema, em qualquer ordem. `tema: personalizado` não aplica nada.
- O estilo dos textos também veste os menus e painéis: na TV antiga, um menu de TV de tubo (painel azul-escuro, letras de pixel e destaque em verde); na Fita VHS, um menu de videocassete (tela azul, maiúsculas brancas, destaque em vídeo invertido); na TV moderna, painéis translúcidos e arredondados. As fontes são embutidas no aplicativo (funcionam sem internet); veja [fontes-e-icones.md](fontes-e-icones.md).

## Lista

| Configuração | Opções | Padrão |
|---|---|---|
| `modo_inicial` | `tv`, `biblioteca` | `tv` |
| `canal_inicial` | nome de uma grade | a primeira grade |
| `canais_por_programa` | sim/não | não |
| `horario` | `continuo`, `real`, `do_inicio` | `continuo` |
| `crt.ligado` | sim/não | sim |
| `crt.intensidade` | `suave`, `media`, `forte` | `media` |
| `crt.curvatura` | número de 0 a 100 (ou `50%`) | `50` |
| `crt.linhas` (scanlines) | sim/não | sim |
| `chuvisco_troca_canal` | sim/não | sim |
| `proporcao` | `4:3`, `esticar`, `original` | `4:3` |
| `vinhetas` | sim/não | sim |
| `comerciais` | sim/não | sim |
| `intervalos.a_cada` | minutos de 0 a 30 (0 = sem intervalo no meio do episódio) | `8` |
| `intervalos.comerciais` | número de 1 a 10 | `3` |
| `intervalos.apos_episodio` | sim/não | sim |
| `intervalos.vinhetas` | sim/não | sim |
| `relogio_na_tela` | sim/não | não |
| `tema` | `tv_antiga`, `vhs`, `tv_moderna`, `personalizado` | `tv_antiga` |
| `marca_dagua` | caminho de uma imagem dentro da biblioteca (PNG, WebP ou JPG) | nenhuma |
| `marca_dagua_ligada` | sim/não | sim |
| `idioma` | ainda não suportada (veja "Ainda não implementada") | |

### `canal_inicial`

O canal que abre na primeira vez, indicado pelo nome da grade (ou pelo nome do arquivo dela). Se o navegador já lembra do último canal assistido, esse canal vence: `canal_inicial` só vale quando ainda não há um canal salvo.

### `canais_por_programa`

Cria um canal extra para cada programa da biblioteca, que passa só os episódios dele, um atrás do outro, com os intervalos comerciais (veja `intervalos`) entre eles. Ficam depois dos canais das grades. Vem desligado: a TV mostra só os canais das grades (por exemplo, só a TV Globinho que o `tv-gominho grade` monta).

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

Valem de forma independente. `vinhetas: não` tira as vinhetas das grades, as de `intervalos` que preenchem os espaços entre blocos e as que enquadram os intervalos comerciais (`intervalos.vinhetas`); `comerciais: não` tira os comerciais (itens `comerciais` da grade e os de `vinhetas/comerciais/`, inclusive no preenchimento). Os episódios e os horários dos blocos não mudam.

### `intervalos`

Os intervalos comerciais, como na TV de verdade (como eles são colocados está em [grade.md](grade.md)):

```yaml
intervalos:
  a_cada: 8            # minutos de episódio entre intervalos; 0 = sem intervalo no meio do episódio
  comerciais: 3        # quantos comerciais por intervalo (1 a 10)
  apos_episodio: sim   # um intervalo depois de cada episódio
  vinhetas: sim        # vinheta ao entrar e ao voltar de cada intervalo
```

- **`a_cada`**: de 0 a 30 minutos. Um episódio de 22 minutos com `a_cada: 8` é cortado em três atos de 7 min 20 s, com um intervalo entre cada um. Episódios curtos (menos que `a_cada` + 2 minutos) não são cortados. Com `0`, os episódios passam inteiros e só há o intervalo do fim. Um episódio pode ter seus próprios pontos de corte em `episodios.yaml` (veja [biblioteca.md](biblioteca.md)).
- **`comerciais`**: de 1 a 10 comerciais em cada intervalo. Cada comercial dura uns 30 segundos nos anúncios de época, então 3 comerciais são cerca de um minuto e meio.
- **`apos_episodio`**: um intervalo no fim de cada episódio. Se a grade já tem um `comerciais: N` logo depois do episódio, não há intervalo extra.
- **`vinhetas`**: as vinhetas que enquadram cada intervalo, como na TV de verdade: uma **entrando** ("TV Globinho volta já") e uma **voltando** ("estamos de volta"), de `vinhetas/intervalos/` (como organizar as pastas e nomear os arquivos está em [biblioteca.md](biblioteca.md)). Cada intervalo fica assim: vinheta de entrada, comerciais, vinheta de saída. Sem vinhetas em `intervalos/`, ou sem uma das duas pontas, o intervalo passa sem elas. Quais passam em cada dia vem da grade (`vinhetas_intervalo`, veja [grade.md](grade.md)) ou, sem isso, de um sorteio diário entre as subpastas.
- Os quatro só valem com `comerciais: sim` e com comerciais em `vinhetas/comerciais/`. Valores fora dos limites geram um aviso e viram o limite mais próximo; os que faltam ficam no padrão.
- `intervalos.vinhetas` respeita também a chave geral `vinhetas`: `vinhetas: não` (que tira **todas** as vinhetas) tira estas também, mesmo com `intervalos.vinhetas: sim`. O contrário não vale: `intervalos.vinhetas: não` tira só as vinhetas dos intervalos, e as da grade e as dos espaços entre blocos continuam.
- No app (Configurações → Intervalos comerciais), as mesmas opções são barras e interruptores ("Vinhetas de intervalo" é o último), apagados enquanto os comerciais estiverem desligados (as vinhetas de intervalo também, se as vinhetas gerais estiverem desligadas).

### `marca_dagua`

Uma imagem pequena fixa no canto inferior direito da tela, como o logotipo da emissora que fica no canto da imagem na TV de verdade:

```yaml
marca_dagua: marca.png
```

- **Onde fica o arquivo:** dentro da pasta da biblioteca (a que tem `programas/`, `vinhetas/` e `grades/`), e o caminho é relativo a ela: `marca.png` na raiz da biblioteca, ou `imagens/marca.png` numa subpasta. Maiúsculas e minúsculas não importam. Caminho absoluto (`/casa/marca.png`, `C:\marca.png`) e `..` não valem.
- **Formato:** PNG ou WebP com fundo transparente é o ideal (JPG também funciona, mas fica com o fundo retangular). Prefira uma imagem simples, sem muitos detalhes finos, e com pelo menos uns 200 pixels de largura. Um logotipo claro, ou claro com contorno escuro, aparece bem sobre qualquer cena.
- **Tamanho e posição:** ocupa até uns 11% da largura da imagem (e 20% da altura), sempre mantendo a proporção, com uma margem de 6% da borda de baixo e da direita, dentro da área segura. É desenhada semitransparente (65%).
- **Quando aparece:** enquanto passa um programa. Some nas vinhetas, nos comerciais, no chuvisco e na tela de "fora do ar". Aparece **dentro da tela da TV**: com o efeito CRT ligado ela acompanha a curvatura, as linhas e o brilho da imagem; com o CRT desligado fica por cima da imagem lisa. Na Biblioteca (assistindo a um programa fora da grade) não aparece.
- **Se der errado:** uma imagem que não está na biblioteca, um caminho inválido ou um arquivo que não é imagem geram um aviso (Menu → Avisos) e a marca d'água é ignorada; a TV segue normalmente. Não confunda com o `logo.png` de cada programa (veja [biblioteca.md](biblioteca.md)), que é o logotipo do programa na página dele.
- **Relógio:** com `relogio_na_tela` ligado, o relógio dos temas TV antiga e TV moderna fica no canto superior esquerdo e não se mexe. O da Fita VHS fica no canto inferior direito, o mesmo da marca d'água: enquanto a marca d'água estiver ligada (mesmo nos momentos em que ela some, como nas vinhetas), ele fica no canto inferior esquerdo: o canto de baixo à direita fica só para a marca d'água. A barra de informações do programa (que aparece por uns segundos) cobre a marca d'água enquanto estiver na tela.
- **Desligar:** `marca_dagua_ligada: não` esconde a marca d'água sem apagar o `marca_dagua`. No app, é o interruptor "Marca d'água" em Configurações → Imagem, e vale na hora, com ou sem CRT. Sem `marca_dagua` na biblioteca, o interruptor fica apagado ("Sem marca d'água na biblioteca"). A escolha do app fica salva no navegador, como as outras, e "Restaurar padrões" a apaga. Só quem escreve o `configuracoes.yaml` escolhe a imagem: o app não troca de imagem.

### Ainda não implementada

**`idioma` ainda não é suportada.** Se aparecer no arquivo, gera um aviso ("A opção "idioma" ainda não é suportada nesta versão e foi ignorada.") e é ignorada: o aplicativo continua em português do Brasil, seja qual for o valor.

## Exemplo de `configuracoes.yaml`

```yaml
horario: real
crt:
  intensidade: suave
  curvatura: 30
comerciais: false
intervalos:
  a_cada: 10
```

Só é preciso escrever o que muda em relação ao padrão.
