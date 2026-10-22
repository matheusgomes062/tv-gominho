# Visão geral e arquitetura

## Objetivo

Qualquer pessoa deve conseguir colocar um pendrive na TV e assistir aos desenhos da TV Globinho como antigamente. Quem quiser mais controle pode usar o app completo, com configurações.

## Princípios

1. **A experiência vem pronta.** Por padrão: modo TV, efeito CRT, vinhetas e intervalos ligados. Tudo pode ser desligado nas configurações.
2. **Funciona com controle remoto.** Toda a interface é navegável com setas, OK e voltar. Mouse e toque são extras.
3. **Pastas simples.** A biblioteca é só um conjunto de pastas e arquivos de texto (YAML) que qualquer pessoa consegue editar.
4. **Determinístico.** Dado o dia e a hora, a grade sempre resulta no mesmo episódio no mesmo ponto. Não é preciso salvar estado, e dois aparelhos mostram a mesma coisa.
5. **Sem conteúdo protegido no repositório.** Nada de episódios, vinhetas originais ou logos da Globo.

## Modos de uso

| Modo | Descrição |
|---|---|
| **Modo TV** | Canal "ao vivo" seguindo a grade. Não dá para escolher o episódio, só trocar de canal (cada grade é um canal). |
| **Modo Biblioteca** | Navegação por programas e episódios, com capas, estilo streaming. |

## Plataformas

| Alvo | Como funciona | Experiência |
|---|---|---|
| **Navegador local** (primeira versão) | Página aberta no Chrome/Edge do computador; o usuário escolhe a pasta da biblioteca, nada é enviado. Mais tarde pode ser hospedada como site | Completa, só Chrome/Edge no computador |
| **Servidor caseiro** (Node / Docker) | Roda num PC ou Raspberry Pi e serve a interface para qualquer navegador da rede | Completa |
| **Raspberry Pi quiosque** | O Pi liga direto num navegador em tela cheia, conectado à TV por HDMI | Completa |
| **App Android TV** | A mesma interface empacotada como app; lê a biblioteca de um pendrive na TV Box | Completa |
| **Pendrive comum** | Programação pré-renderizada em MP4, tocada pelo player da própria TV | Simplificada (configurações escolhidas na hora de gerar o pendrive) |

## Arquitetura

Um núcleo único em TypeScript, usado por todos os alvos:

```
pacotes/
  nucleo/        # leitura da biblioteca + motor da grade (sem dependência de plataforma)   [Fase 1]
  interface/     # interface web (React + Vite), navegável por controle remoto              [Fase 1]
  cli/           # ferramenta de linha de comando: converter vídeos ✅, montar a grade ✅, gerar
                 # e verificar o pendrive (ffmpeg) ✅, servir o app e a biblioteca na rede ✅
  android-tv/    # empacotamento da interface com Capacitor                                 [Fase 4]
scripts/raspberry-pi/  # instalador do modo quiosque (usa o `tv-gominho servir`)          [Fase 5]
```

- **`nucleo`** recebe a lista de arquivos por um "adaptador" (pasta escolhida no navegador, sistema de arquivos do Node, pendrive no Android). Assim, a mesma lógica roda em todo lugar.
- **Primeira versão:** a `interface` roda sozinha no navegador e lê a pasta da biblioteca direto do computador, sem servidor (também abrindo o `index.html` direto de um pendrive). Com o `tv-gominho servir`, o mesmo app recebe a biblioteca pela rede e abre sozinho no canal.
- **Leve:** o app inteiro tem ~1 MB (o JavaScript viaja comprimido, ~120 KB); a ferramenta é um arquivo de ~245 KB. No efeito CRT, o quadro só é redesenhado quando o vídeo tem quadro novo, e a resolução interna do tubo cai sozinha (100%, 75%, 50%) se o vídeo começar a perder quadros, para aparelhos fracos como o Raspberry Pi.
- **Efeito CRT:** shader WebGL sobre o vídeo na interface. No pendrive, o efeito é aplicado com filtros do ffmpeg na hora de gerar os arquivos.
- **Formatos de vídeo:** a interface toca MP4 (H.264 + AAC). Arquivos antigos (AVI, MKV, etc.) são convertidos uma vez pela `cli` (`tv-gominho converter`, veja [ferramentas.md](ferramentas.md)). O Raspberry Pi e as TV Boxes não têm força para converter em tempo real.

Pilha: TypeScript, React + Vite, monorepo com npm workspaces. Veja as decisões em [roteiro.md](roteiro.md).

## Convenção de idioma

- **Pastas, arquivos YAML, interface e documentação:** português (pt-BR), porque são feitos para o usuário.
- **Código-fonte** (variáveis, funções, commits): inglês, para facilitar contribuições.

## Projetos parecidos

ErsatzTV, Tunarr e dizqueTV criam canais "ao vivo" a partir de bibliotecas do Plex/Jellyfin. A TV Gominho se diferencia por não depender de Plex/Jellyfin, ter grades históricas da TV Globinho, a experiência de TV de tubo e o pendrive para qualquer TV.
