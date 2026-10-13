# Roteiro

## Fases

### Fase 0: Especificação ✅
- [x] Visão geral, plataformas e arquitetura
- [x] Organização da biblioteca
- [x] Formato da grade
- [x] Configurações
- [x] Pendrive
- [x] Nome, licença e pilha técnica

### Fase 1: Versão local no navegador (atual)
Sem servidor e sem instalação: uma página que lê a pasta `biblioteca` direto do computador. Nada é enviado para a internet.

- Botão "Escolher biblioteca" (File System Access API, só Chrome/Edge no computador)
- Leitura da biblioteca (programas, episódios, vinhetas, grades) com avisos claros quando algo está errado
- Motor da grade (determinístico, com testes)
- **Modo Biblioteca:** programas com capas, lista de episódios, player
- **Modo TV básico:** segue uma grade, com vinhetas entre os programas
- Navegação por teclado (setas, Enter, Esc), preparando para o controle remoto
- Só arquivos MP4 (H.264 + AAC); a conversão fica para depois

**Pronto quando:** uma biblioteca de exemplo com 2 programas e uma grade toca no Chrome, nos dois modos.

### Fase 2: Experiência de TV
- Efeito CRT (WebGL), chuvisco na troca de canal, proporção 4:3
- Menu de configurações
- Comerciais, tela de "fora do ar", horários `real` e `do_inicio`

### Fase 3: Ferramentas e pendrive
- Ferramenta `converter` (ffmpeg)
- Ferramenta `pendrive` (linha de comando e interface)
- Efeito CRT em ffmpeg, divisão em partes < 4 GB, normalização de áudio
- Teste em pelo menos 3 modelos de TV

### Fase 4: App Android TV
- Empacotamento com Capacitor
- Leitura da biblioteca a partir do pendrive na TV Box

### Fase 5: Servidor caseiro e Raspberry Pi
- Servidor Node que entrega a interface e os vídeos para qualquer navegador da rede
- Imagem/script para Raspberry Pi em modo quiosque
- Docker

## Decisões

1. ~~**Nome do projeto.**~~ Decidido: **TV Chuvisco** (`tv-chuvisco`). "TV Globinho" aparece só de forma descritiva, com o aviso de que o projeto não tem afiliação com a Globo.
2. ~~**Licença.**~~ Decidido: **GPL-3.0** (veja [`LICENSE`](../LICENSE)). Versões modificadas e distribuídas precisam continuar livres.
3. ~~**Pilha técnica.**~~ Decidido: **TypeScript** em todo o projeto. React + Vite na interface, monorepo com npm workspaces. Mais tarde: Node no servidor, Capacitor no Android TV, ffmpeg nas ferramentas. Rust foi considerado e descartado: o trabalho pesado (vídeo) é do navegador e do ffmpeg, e uma linguagem só facilita as contribuições.

## Em aberto

1. **Fontes das grades históricas.** Onde pesquisar a programação de cada ano (acervos de jornais, guias de TV, fóruns e gravações de fãs).
2. **Biblioteca de exemplo.** Vídeos de domínio público (por exemplo, desenhos antigos do Internet Archive) para testes e demonstração sem conteúdo protegido.
