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
    intervalos/              # "voltamos já", passagens entre programas
    comerciais/              # comerciais antigos (opcional)
    chamadas/                # chamadas de programação (opcional)
  grades/
    globinho-2003.yaml       # grades de programação (veja grade.md)
  configuracoes.yaml         # configurações padrão (opcional, veja configuracoes.md)
```

## Regras

- **Nome da pasta do programa** é o identificador usado na grade: letras minúsculas, sem acentos, com hífens (`bob-esponja`).
- **Ordem dos episódios:** pelo número no início do nome do arquivo (`001`, `002`, ...). Sem número, a ordem é alfabética natural (`2` vem antes de `10`).
- **Temporadas** são opcionais. Se existirem, as pastas `temporada-NN` são lidas em ordem e os episódios ficam numa sequência só.
- **Título do episódio:** vem de `episodios.yaml`. Se não houver, usa o nome do arquivo sem o número (`A Volta de Goku`).
- **Arquivos ignorados:** qualquer coisa que não seja vídeo, imagem ou YAML conhecido, e arquivos que começam com `.`.
- **Vinhetas** podem ficar em subpastas dentro de cada categoria (por exemplo, `vinhetas/aberturas/2003/`). A grade pode apontar para a categoria inteira ou para uma subpasta.

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

## Formatos

| Tipo | Formato recomendado | Observação |
|---|---|---|
| Vídeo | MP4 com H.264 + AAC | Outros formatos (AVI, MKV, WMV, RMVB...) devem ser convertidos com `tv-chuvisco converter` |
| Imagens | JPG ou PNG | `capa.jpg` na proporção 2:3; `fundo.jpg` na proporção 16:9 |
| Texto | YAML em UTF-8 | |

A ferramenta de conversão gera os novos arquivos ao lado dos originais e nunca apaga nada sem confirmação.
