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
- Menu de configurações ✅ (base pronta: camadas padrão/arquivo/menu, tela navegável pelo controle, modo e canal inicial, canais por programa, chuvisco, proporção, vinhetas, comerciais, relógio, `marca_dagua`; falta `idioma`)
- Comerciais ✅, tela de "fora do ar" ✅, horários `real` e `do_inicio` ✅ (tela de teste de cores com a hora da volta e volta automática, sobra de meia-noite; maratona que segue pelos próximos dias da grade e retoma ao voltar ao canal)

### Fase 3: Ferramentas e pendrive
- Ferramenta `converter` (ffmpeg) ✅ (pacote `cli`; detecta formatos antigos e codecs incompatíveis, só troca o contêiner quando dá, originais vão para `.originais`, normalização de áudio opcional; veja [ferramentas.md](ferramentas.md))
- Ferramenta `pendrive` na linha de comando ✅ (`tv-gominho pendrive`: dias da grade no estilo `do_inicio`, intervalos comerciais, partes de menos de 4 GB, `--simular`, cópia da biblioteca, retomada, `--resolucao 480`; veja [pendrive.md](pendrive.md)). Falta a tela "Criar pendrive" na interface
- Ferramenta `organizar` ✅: arruma vídeos baixados na biblioteca com o Jev (TypeSafe), que reconhece programa, tipo de vídeo e emissora pelo nome; opcional, só os nomes saem do computador
- Ferramenta `grade` ✅: monta o canal TV Gominho no estilo da TV Globinho (aberturas, chamadas, encerramentos e vinhetas de intervalo da época) com os programas da biblioteca; o Canal Automático usa o mesmo motor
- Ferramenta `verificar` ✅: confere um pendrive como o player USB da TV (codecs, níveis, FAT32, nomes)
- Efeito CRT em ffmpeg, divisão em partes < 4 GB, normalização de áudio ✅
- Teste em pelo menos 3 modelos de TV (até lá, o `verificar` compara com os limites publicados pelos fabricantes)

### Fase 4: App Android TV
- Empacotamento com Capacitor
- Leitura da biblioteca a partir do pendrive na TV Box

### Fase 5: Servidor caseiro e Raspberry Pi
- Servidor Node que entrega a interface e os vídeos para qualquer navegador da rede ✅ (`tv-gominho servir`)
- Script para Raspberry Pi em modo quiosque ✅ ([raspberry-pi.md](raspberry-pi.md); simulado no PC, falta testar num Pi de verdade)
- Pacote portátil (`npm run pacote`, ~1,2 MB) ✅
- Docker

## Decisões

1. ~~**Nome do projeto.**~~ Decidido: **TV Gominho** (`tv-gominho`). "TV Globinho" aparece só de forma descritiva, com o aviso de que o projeto não tem afiliação com a Globo.
2. ~~**Licença.**~~ Decidido: **GPL-3.0** (veja [`LICENSE`](../LICENSE)). Versões modificadas e distribuídas precisam continuar livres.
3. ~~**Pilha técnica.**~~ Decidido: **TypeScript** em todo o projeto. React + Vite na interface, monorepo com npm workspaces. Mais tarde: Node no servidor, Capacitor no Android TV, ffmpeg nas ferramentas. Rust foi considerado e descartado: o trabalho pesado (vídeo) é do navegador e do ffmpeg, e uma linguagem só facilita as contribuições.

## Em aberto

1. **Fontes das grades históricas.** Onde pesquisar a programação de cada ano (acervos de jornais, guias de TV, fóruns e gravações de fãs). Ponto de partida: [lista de programas da TV Globinho](programas-tv-globinho.md).
2. ~~**Biblioteca de exemplo.**~~ `npm run exemplo:real` baixa Superman (Fleischer), Popeye, Gato Félix e, desde 2026-10-22, os coloridos Pica-Pau, Gasparzinho, Luluzinha e Pernalonga em domínio público do Internet Archive (fontes em `CREDITOS.txt`). Conferido em 2026-10-21 (levantamento, não parecer jurídico):
   - **Brasil:** obras audiovisuais ficam protegidas por 70 anos contados de 1º de janeiro do ano seguinte à divulgação (Lei 9.610/98, art. 44). Os 19 desenhos são de 1919 a 1947, então estão em domínio público no Brasil desde 2018 ou antes.
   - **EUA:** os Gato Félix (1919–1923) são anteriores a 1929. Os Superman da Fleischer (1941–1942) e os três especiais coloridos do Popeye (1936–1939) não tiveram o copyright renovado; no caso do Popeye a fonte é secundária (sem registro oficial encontrado). "O Pequeno Zezinho" (*Little Swee'Pea*, 1936) circula como domínio público, mas não achei fonte que confirme. Os coloridos de 1941 a 1947 (Pica-Pau "Pantry Panic", Gasparzinho "The Friendly Ghost" e "There's Good Boos To-Night", Luluzinha "Bored of Education" e "A Bout with a Trout", Pernalonga "Falling Hare" e "A Corny Concerto") foram conferidos um a um na [lista da Wikipédia](https://en.wikipedia.org/wiki/List_of_animated_films_in_the_public_domain_in_the_United_States), que também passou a listar os três especiais do Popeye. Ficaram de fora, mesmo livres, "Fresh Hare" (final com números de menestrel), "Wackiki Wabbit" (caricatura racial) e "Daffy – The Commando" (propaganda de guerra).
   - **Outros países:** alguns (Alemanha, Suíça, Canadá) não aplicam a regra americana da não renovação, e os Superman ainda podem estar protegidos lá. O `CREDITOS.txt` já pede para conferir a lei local antes de redistribuir.
   - **Marcas:** os nomes e personagens (Superman, Popeye, Gato Félix, Pica-Pau, Gasparzinho, Luluzinha, Pernalonga) continuam sendo marcas dos donos. O projeto não distribui os vídeos: o script baixa do Internet Archive quando a pessoa pede, e só as versões originais em inglês (dublagens têm direitos próprios).
