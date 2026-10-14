# TV Chuvisco

Um player de vídeo livre (FOSS) para reviver as manhãs de desenho como na **TV Globinho**, numa TV antiga: você liga e o desenho já está passando, com vinhetas, intervalos e aquele chuvisco de tubo.

Você coloca os seus próprios episódios em pastas organizadas, escolhe uma grade de programação (por exemplo, "TV Globinho 2003") e a TV Chuvisco cuida do resto.

> **Status:** primeira versão em desenvolvimento: roda no navegador (Chrome/Edge) lendo a pasta da biblioteca do seu computador. Veja o [roteiro](docs/roteiro.md).

## Duas formas de assistir

- **Modo TV (padrão):** um canal "ao vivo" que segue uma grade de programação, com efeito de TV de tubo (CRT). Tudo pode ser ajustado ou desligado nas configurações.
- **Modo Biblioteca:** navegue pelos programas como num serviço de streaming e escolha o episódio que quiser.

## Onde funciona

| Onde | Como |
|---|---|
| PC / notebook | Direto no navegador (Chrome/Edge), escolhendo a pasta da biblioteca. Primeira versão |
| Raspberry Pi | Servidor local, ou modo quiosque ligado direto na TV |
| TV Box (Android TV) | App para Android TV lendo os episódios de um pendrive |
| Qualquer TV com USB | Pendrive com a programação já pronta em MP4 |

## Documentação

1. [Visão geral e arquitetura](docs/visao-geral.md)
2. [Organização da biblioteca (pastas e arquivos)](docs/biblioteca.md)
3. [Formato da grade de programação](docs/grade.md)
4. [Configurações](docs/configuracoes.md)
5. [Pendrive para qualquer TV](docs/pendrive.md)
6. [Roteiro e decisões em aberto](docs/roteiro.md)

## Rodando o projeto

Requisitos: [Node.js](https://nodejs.org) 22 ou mais novo. Para gerar a biblioteca de exemplo, também o [ffmpeg](https://ffmpeg.org).

```sh
npm install
npm run exemplo   # gera exemplo/biblioteca com vídeos de teste (precisa do ffmpeg)
npm run dev       # abre em http://localhost:5173
```

No navegador, clique em **Escolher biblioteca** e selecione a sua pasta `biblioteca`, ou em **Usar biblioteca de exemplo**.

| Comando | O que faz |
|---|---|
| `npm run exemplo:real` | Baixa desenhos clássicos em domínio público (~570 MB) para `exemplo/dominio-publico/biblioteca` |
| `npm run comerciais` | Gera comerciais fictícios (anos 90/2000) em `vinhetas/comerciais` da biblioteca de domínio público; narração opcional via Piper (`-- --instalar-voz`) |
| `npm test` | Testes do núcleo (leitura da biblioteca e motor da grade) |
| `npm run typecheck` | Verificação de tipos do TypeScript |
| `npm run build` | Gera a versão final em `pacotes/interface/dist` |

### Controles

| Tecla | Na TV | Na biblioteca |
|---|---|---|
| ↑ ↓ | Troca de canal (grades e programas) | Navega |
| ← → | | Navega (no player: volta/avança 10 s) |
| Enter / OK | Mostra o que está passando | Abre |
| Esc / Backspace | Abre o menu | Volta |
| 1–9 | Vai direto para o canal | |

## Licença

[GPL-3.0](LICENSE).

## Importante

- Este projeto **não distribui episódios, vinhetas nem marcas da Globo**. Cada pessoa usa os próprios arquivos.
- TV Chuvisco é um projeto independente de fãs, **sem afiliação com a Globo**. "TV Globinho" é marca de seus respectivos donos e aparece aqui só para descrever o que o projeto recria.

---

## English

TV Chuvisco is a FOSS player that recreates the experience of watching *TV Globinho*, a Brazilian kids' TV block, on an old CRT TV. It is an independent fan project, not affiliated with Globo. Users supply their own episode files; the app plays them following a historical broadcast schedule, with bumpers and a CRT effect, or lets you browse them on demand. Documentation is written in Brazilian Portuguese first; see [`docs/`](docs/).
