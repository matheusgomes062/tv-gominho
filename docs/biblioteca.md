# Organização da biblioteca

A biblioteca é uma pasta chamada `biblioteca/`. Ela pode estar no PC, no Raspberry Pi ou na raiz de um pendrive.

## Estrutura

```
biblioteca/
  programas/
    dragon-ball-z/
      programa.yaml          # informações do programa
      capa.jpg               # pôster vertical (obrigatório para o Modo Biblioteca)
      fundo.jpg              # imagem horizontal de fundo (opcional)
      logo.png               # logo com fundo transparente (opcional)
      episodios.yaml         # títulos e descrições dos episódios (opcional)
      episodios/
        001 - A Volta de Goku.mp4
        002 - O Inimigo de Goku.mp4
    bob-esponja/
      programa.yaml
      capa.jpg
      episodios/
        temporada-01/
          001 - Ajuda-se Precisa-se.mp4
  vinhetas/
    aberturas/               # abertura do bloco
    encerramentos/           # encerramento do bloco
    intervalos/              # vinhetas de intervalo ("volta já" / "estamos de volta"), uma subpasta por canal
      tv-globinho/
        entrada-01.mp4       # entrando no intervalo: "TV Globinho volta já"
        saida-01.mp4         # voltando dele: "estamos de volta"
      cartoon-network/
    comerciais/              # comerciais antigos (opcional)
    chamadas/                # chamadas de programação (opcional)
  grades/
    gominho-2003.yaml        # grades de programação (veja grade.md)
  configuracoes.yaml         # configurações padrão (opcional, veja configuracoes.md)
  nao-passar.yaml            # programas e episódios que o app nunca escolhe sozinho (opcional)
```

## Regras

- **Nome da pasta do programa** é o identificador usado na grade: letras minúsculas, sem acentos, com hífens (`bob-esponja`).
- **Ordem dos episódios:** pelo número no início do nome do arquivo (`001`, `002`, ...). Também valem nomes comuns de arquivos baixados, como `1x01 - Título`, `S01E01 - Título`, `Programa - S02E05` e `DBZ_Episodio 001_www.site.com` (marcas de sites não viram título; nesse caso o título fica "Episódio 1"). Sem número, a ordem é alfabética natural (`2` vem antes de `10`).
- **Onde ficam os episódios:** o recomendado é a pasta `episodios/`, mas qualquer vídeo dentro da pasta do programa conta como episódio.
- **Temporadas** são opcionais. Se existirem, as pastas `temporada-NN` são lidas em ordem e os episódios ficam numa sequência só.
- **Título do episódio:** vem de `episodios.yaml`. Se não houver, usa o nome do arquivo sem o número (`A Volta de Goku`).
- **Arquivos ignorados:** qualquer coisa que não seja vídeo, imagem ou YAML conhecido, e arquivos que começam com `.`.
- **Cópias de segurança de canais:** ao trocar um canal pelo assistente, o app guarda o arquivo antigo em `grades/` com o nome `<canal>.AAAA-MM-DD.yaml.bak` (por exemplo `manha.2026-10-22.yaml.bak`). Por terminar em `.bak`, ela **não é lida como canal** e não gera aviso. Para voltar atrás, apague o canal novo e renomeie a cópia, tirando a data e o `.bak` (`manha.yaml`). Pode apagar as cópias quando não precisar mais.
- **Vinhetas** podem ficar em subpastas dentro de cada categoria (por exemplo, `vinhetas/aberturas/2003/`). A grade pode apontar para a categoria inteira ou para uma subpasta.

## Vinhetas de intervalo (`vinhetas/intervalos/`)

As TVs de verdade (TV Globinho, Cartoon Network, Disney Channel, Jetix, Nickelodeon...) enquadravam cada intervalo comercial com duas vinhetas: uma **entrando** no intervalo ("TV Globinho volta já", "a seguir") e uma **voltando** dele ("estamos de volta"). O app passa essas vinhetas ao redor dos comerciais: **entrada, comerciais, saída**. Quem decide quais vinhetas passam são a pasta e o nome dos arquivos:

```
vinhetas/intervalos/
  tv-globinho/
    entrada-01.mp4
    entrada-02.mp4
    saida-01.mp4
    volta-ja.mp4            # sem "entrada" nem "saída": serve nos dois lugares
  cartoon-network/
    entrada.mp4
    saída.mp4
  avulsa.mp4                # fora de subpasta: forma um grupo só dela
```

- **Uma subpasta por canal ou marca** (`tv-globinho`, `cartoon-network`, `disney-channel`, `jetix`, `nickelodeon`...). Num mesmo intervalo, as duas vinhetas saem sempre da mesma subpasta: nunca uma entrada da Globinho com uma volta da Cartoon Network. Arquivos soltos direto em `vinhetas/intervalos/` (sem subpasta) formam um grupo próprio. Subpastas mais fundas (`tv-globinho/2005/`) contam como a subpasta de cima.
- **O papel vem do nome do arquivo**, sem distinguir maiúsculas nem acentos, e só vale a palavra inteira: um nome com a palavra `entrada` (`entrada-01.mp4`, `Entrada 2.mp4`) vai **entrando** no intervalo; com `saida` ou `saída` (`saida.mp4`, `volta_saída.mp4`), **voltando** dele. Números e hífens contam como separadores (`entrada2` vale), mas `entradas` não. Com nenhuma das duas palavras (ou com as duas), o arquivo é **genérico** e pode ser usado nos dois lugares. O nome da pasta não conta, só o do arquivo.
- **Qual canal passa no dia:** o motor sorteia uma subpasta por dia (com a mesma semente dos outros sorteios, então é igual em todo aparelho) e usa só ela em todos os intervalos daquele dia: o canal "parece" uma emissora só. Uma grade pode escolher a marca com `vinhetas_intervalo` (veja [grade.md](grade.md)).
- **Se faltar um dos lados:** uma subpasta sem nenhuma vinheta de entrada (nem genérica) fica sem vinheta ao entrar no intervalo; sem nenhuma de saída (nem genérica), fica sem ao voltar. O intervalo segue normal, só sem aquela vinheta. O motor evita repetir o mesmo arquivo em seguida quando há outro à escolha.
- As vinhetas de intervalo só passam quando o intervalo acontece (comerciais ligados e comerciais na biblioteca) e com a opção `intervalos.vinhetas` ligada (padrão); veja [configuracoes.md](configuracoes.md). Os arquivos de `intervalos/` continuam valendo como item escrito na grade (`vinheta: intervalos/...`) e como tapa-buracos entre blocos.

## `programa.yaml`

```yaml
titulo: Dragon Ball Z
titulo_original: ドラゴンボールZ
ano: 1989
descricao: Goku e seus amigos defendem a Terra de inimigos cada vez mais fortes.
classificacao: 10          # opcional
ordem: sequencial          # sequencial (padrão) | aleatoria
```

Só `titulo` é obrigatório.

## `episodios.yaml` (opcional)

```yaml
"001":
  titulo: A Volta de Goku
  descricao: Cinco anos depois, Goku apresenta seu filho Gohan aos amigos.
"002":
  titulo: O Inimigo de Goku
```

A chave é o número do episódio do nome do arquivo.

### Pontos dos intervalos comerciais (`intervalos`)

Por padrão, o app divide cada episódio em atos iguais e coloca um intervalo comercial entre eles (veja [grade.md](grade.md)). Se o episódio tem pontos melhores para cortar (por exemplo, os fades para preto que a emissora usava para os comerciais), diga os pontos exatos:

```yaml
"001":
  titulo: A Volta de Goku
  intervalos: ["7:32", "14:10"]   # minutos:segundos (ou h:mm:ss, ou só segundos)
```

O episódio passa até 7:32, vêm os comerciais, e ele continua de 7:32 até 14:10, e assim por diante. Esses pontos valem no lugar da divisão automática; só são ignorados se os intervalos no meio do episódio estiverem desligados (`intervalos.a_cada: 0`) ou os comerciais estiverem desligados. Pontos fora da duração do episódio são ignorados, e tempos que não fazem sentido geram um aviso na tela de Avisos.

## Não passar (`nao-passar.yaml`)

Para um episódio impróprio, ou um programa que as crianças ainda não podem ver, nunca passar sozinho: coloque-o em `nao-passar.yaml`, **na raiz da biblioteca** (ao lado de `configuracoes.yaml`). Nenhum arquivo é apagado.

```yaml
programas: [dragon-ball-z]          # programas inteiros (o nome da pasta)
episodios:
  pica-pau: [3, "temporada-02/12"]  # episódios de um programa
  bob-esponja: 7                    # um só pode ser escrito sem lista
```

- **Programas:** o nome da pasta do programa, como na grade. **Episódios:** o programa e, para cada episódio, o número que está no começo do nome do arquivo (`012 - Título.mp4` é o `12`), o mesmo das chaves de `episodios.yaml`. Se o programa tem temporadas que repetem números, escreva a pasta da temporada antes: `"temporada-02/12"`. Um número sem temporada vale para todas as temporadas que o têm (e o app avisa).
- **Vale para todos os canais:** as grades, o Canal Automático e os canais por programa. Só vale quando o app escolhe sozinho (o modo dinâmico); um episódio escolhido à mão na [agenda](grade.md#agenda) passa mesmo estando na lista, porque a escolha explícita vale mais.
- **Programas em sequência:** a sequência passa a andar **só pelos episódios permitidos**. Com 5 episódios e o 2 e o 4 na lista, o programa passa 1, 3, 5, 1, 3, 5... Quem lê os mesmos arquivos vê a mesma coisa em todo aparelho, mas atenção: mudar a lista muda a contagem desde o `data_inicio`, então os episódios que passam daí em diante podem mudar. Depois de um episódio da agenda, o programa continua pelo próximo episódio **permitido** depois dele (se o escolhido estava na lista, o primeiro permitido que vem depois).
- **Programas com `ordem: aleatoria`:** o sorteio nunca escolhe um episódio da lista. Os outros sorteios do dia (vinhetas, comerciais, outros programas) continuam iguais.
- **Programa inteiro na lista (ou todos os episódios dele):** o item da grade é pulado, com um aviso, como um programa que não existe. O Canal Automático e os canais por programa nem incluem esse programa.
- **Avisos, nunca erros:** programa ou episódio que não existe na biblioteca, chave desconhecida ou arquivo mal escrito geram um aviso na tela de Avisos e a entrada é ignorada; o resto da lista vale. Um arquivo com erro de sintaxe é ignorado por inteiro.
- O `tv-gominho pendrive` também respeita a lista.

## Formatos

| Tipo | Formato recomendado | Observação |
|---|---|---|
| Vídeo | MP4 com H.264 + AAC | Outros formatos (AVI, MKV, WMV, RMVB...) devem ser convertidos com `tv-gominho converter` |
| Imagens | JPG ou PNG | `capa.jpg` na proporção 2:3; `fundo.jpg` na proporção 16:9 |
| Texto | YAML em UTF-8 | |

A ferramenta de conversão gera os novos arquivos ao lado dos originais e nunca apaga nada sem confirmação.
