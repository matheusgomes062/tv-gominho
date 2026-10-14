# Roteiro

## Fases

### Fase 0: Especificação ✅
- [x] Visão geral, plataformas e arquitetura
- [x] Organização da biblioteca
- [x] Formato da grade
- [x] Configurações
- [x] Pendrive
- [x] Nome, licença e pilha técnica

### Fase 1: Versão local no navegador ✅
Sem servidor e sem instalação: uma página que lê a pasta `biblioteca` direto do computador. Nada é enviado para a internet.

- Botão "Escolher biblioteca" (File System Access API, só Chrome/Edge no computador)
- Leitura da biblioteca (programas, episódios, vinhetas, grades) com avisos claros quando algo está errado
- Motor da grade (determinístico, com testes)
- **Modo Biblioteca:** programas com capas, lista de episódios, player
- **Modo TV básico:** segue uma grade, com vinhetas entre os programas
- Navegação por teclado (setas, Enter, Esc), preparando para o controle remoto
- Só arquivos MP4 (H.264 + AAC); a conversão fica para depois

**Pronto quando:** uma biblioteca de exemplo com 2 programas e uma grade toca no Chrome, nos dois modos.

### Fase 2: Experiência de TV (pronta)
- Efeito CRT (WebGL), chuvisco na troca de canal, proporção 4:3 ✅ (tela curva, linhas, máscara, brilho; chuvisco desenhado dentro do tubo; reserva em CSS sem WebGL)
- Menu de configurações ✅ (base pronta: camadas padrão/arquivo/menu, tela navegável pelo controle, modo e canal inicial, canais por programa, chuvisco, proporção, vinhetas, comerciais, relógio; faltam `marca_dagua` e `idioma`)
- Comerciais ✅, tela de "fora do ar" ✅, horários `real` e `do_inicio` ✅ (tela de teste de cores com a hora da volta e volta automática, sobra de meia-noite; maratona que segue pelos próximos dias da grade e retoma ao voltar ao canal)

### Fase 3: Ferramentas e pendrive
- Ferramenta `converter` (ffmpeg) ✅ (pacote `cli`; detecta formatos antigos e codecs incompatíveis, só troca o contêiner quando dá, originais vão para `.originais`, normalização de áudio opcional; veja [ferramentas.md](ferramentas.md))
- Ferramenta `pendrive` na linha de comando ✅ (`tv-chuvisco pendrive`: dias da grade no estilo `do_inicio`, intervalos comerciais, partes de menos de 4 GB, `--simular`, cópia da biblioteca, retomada; veja [pendrive.md](pendrive.md)). Falta a tela "Criar pendrive" na interface
- Efeito CRT em ffmpeg, divisão em partes < 4 GB, normalização de áudio ✅
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

1. **Fontes das grades históricas.** Onde pesquisar a programação de cada ano (acervos de jornais, guias de TV, fóruns e gravações de fãs). Ponto de partida: [lista de programas da TV Globinho](programas-tv-globinho.md).
2. ~~**Biblioteca de exemplo.**~~ Primeira versão: `npm run exemplo:real` baixa Superman (Fleischer), Popeye e Gato Félix em domínio público do Internet Archive (fontes em `CREDITOS.txt`). Falta confirmar o status de cada título com mais cuidado antes de divulgar.
