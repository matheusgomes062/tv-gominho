# Pendrive para qualquer TV

O objetivo: qualquer pessoa coloca o pendrive na TV, aperta play e assiste à TV Globinho, sem instalar nada.

O player embutido das TVs só toca arquivos de vídeo. Ele não roda o app, então a programação é **pré-renderizada**: o app monta a grade e grava o resultado como arquivos MP4 comuns.

## Como gerar

No computador, pela ferramenta "Criar pendrive" (na interface ou pela linha de comando):

1. Escolha a biblioteca e a grade.
2. Escolha quantos dias gerar (por exemplo, 5 dias = segunda a sexta, cada dia com episódios novos).
3. Escolha as configurações: efeito CRT, vinhetas, comerciais, proporção.
4. Escolha o pendrive e clique em **Criar**.

```
tv-chuvisco pendrive --grade globinho-2003 --dias 5 --destino E:\ --sem-comerciais
```

## Estrutura do pendrive

```
E:\
  ASSISTA AQUI/
    Dia 01 - Parte 1.mp4
    Dia 01 - Parte 2.mp4
    Dia 02 - Parte 1.mp4
    ...
  biblioteca/            # opcional: cópia da biblioteca para usar no app da TV Box
  LEIA-ME.txt
```

O mesmo pendrive funciona nos dois casos:
- **TV comum:** abra `ASSISTA AQUI` e toque o primeiro arquivo.
- **TV Box com o app:** o app encontra a pasta `biblioteca` e oferece a experiência completa, com configurações.

## Requisitos técnicos dos arquivos gerados

| Item | Valor | Motivo |
|---|---|---|
| Contêiner | MP4 | O mais aceito pelas TVs |
| Vídeo | H.264, perfil High, nível 4.0 | Compatível com TVs desde ~2012 |
| Resolução | 1280×720, imagem 4:3 com barras pretas nas laterais | Evita que a TV estique a imagem; resolução suficiente para o efeito CRT |
| Áudio | AAC estéreo, 48 kHz, volume normalizado | Evita diferenças de volume entre episódios e vinhetas |
| Tamanho máximo por arquivo | < 4 GB | Pendrives costumam vir em FAT32, que não aceita arquivos maiores. Cada dia é dividido em partes |
| Nomes | Começam com número/ordem | A TV toca na ordem alfabética |

## Limitações

- Não há relógio ao vivo: a programação começa do início ao apertar play.
- Para mudar as configurações (por exemplo, tirar o CRT), é preciso gerar o pendrive de novo.
- Gerar o pendrive leva tempo, porque o ffmpeg precisa recodificar todos os vídeos.
