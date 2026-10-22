# TV Gominho

[![CI](https://github.com/matheusgomes062/tv-gominho/actions/workflows/ci.yml/badge.svg)](https://github.com/matheusgomes062/tv-gominho/actions/workflows/ci.yml)

Um player de vídeo livre (FOSS) para reviver as manhãs de desenho como na **TV Globinho**, numa TV antiga: você liga e o desenho já está passando, com vinhetas, intervalos e aquele chuvisco de tubo.

Você coloca os seus próprios episódios em pastas organizadas e a TV Gominho monta o canal: `tv-gominho grade` cria a programação no estilo da TV Globinho (abertura, desenhos, chamadas, intervalos com comerciais e vinhetas da época, encerramento), e o app passa tudo como uma TV ao vivo.

> **Site:** https://matheusgomes062.github.io/tv-gominho/
>
> **Status:** em desenvolvimento. Roda no navegador (Chrome/Edge), num Raspberry Pi ligado na TV e em qualquer TV com USB (pendrive com a programação pronta). Veja o [roteiro](docs/roteiro.md).

## Duas formas de assistir

- **Modo TV (padrão):** um canal "ao vivo" que segue uma grade de programação, com efeito de TV de tubo (CRT). Tudo pode ser ajustado ou desligado nas configurações.
- **Modo Biblioteca:** navegue pelos programas como num serviço de streaming e escolha o episódio que quiser.

## Onde funciona

| Onde | Como |
|---|---|
| PC / notebook | No navegador (Chrome/Edge), escolhendo a pasta da biblioteca; ou `tv-gominho servir`, que já abre com ela |
| Raspberry Pi | Modo quiosque: liga direto no canal, em tela cheia ([raspberry-pi.md](docs/raspberry-pi.md)) |
| Outros aparelhos da casa | `tv-gominho servir --rede` e o navegador do celular, da TV ou de outro PC |
| Qualquer TV com USB | Pendrive com a programação já pronta em MP4 ([pendrive.md](docs/pendrive.md)), conferido com `tv-gominho verificar` |
| TV Box (Android TV) | App para Android TV lendo os episódios de um pendrive (planejado) |

Leve: o app tem ~1 MB e a ferramenta é um arquivo de ~245 KB. `npm run pacote` junta tudo numa pasta de ~1,2 MB que cabe no pendrive ao lado da biblioteca.

## Documentação

1. [Visão geral e arquitetura](docs/visao-geral.md)
2. [Organização da biblioteca (pastas e arquivos)](docs/biblioteca.md)
3. [Formato da grade de programação](docs/grade.md)
4. [Configurações](docs/configuracoes.md)
5. [Pendrive para qualquer TV](docs/pendrive.md)
6. [Raspberry Pi](docs/raspberry-pi.md)
7. [Ferramentas de linha de comando (converter, grade, pendrive, verificar, servir)](docs/ferramentas.md)
8. [Roteiro e decisões em aberto](docs/roteiro.md)
9. [Programas exibidos pela TV Globinho (lista para busca)](docs/programas-tv-globinho.md)
10. [Como contribuir](CONTRIBUTING.md)

## Rodando o projeto

Requisitos: [Node.js](https://nodejs.org) 22.9 ou mais novo (o pacote portátil roda com 22). Para gerar a biblioteca de exemplo, também o [ffmpeg](https://ffmpeg.org).

```sh
npm install
npm run exemplo   # gera exemplo/biblioteca com vídeos de teste (precisa do ffmpeg)
npm run dev       # abre em http://localhost:5173
```

No navegador, clique em **Escolher biblioteca** e selecione a sua pasta `biblioteca`, ou em **Usar biblioteca de exemplo**.

| Comando | O que faz |
|---|---|
| `npm run exemplo:real` | Baixa desenhos clássicos em domínio público, inclusive coloridos como Pica-Pau e Pernalonga (~830 MB) para `exemplo/dominio-publico/biblioteca` |
| `npm run cli -- converter <biblioteca>` | Converte AVI, MKV e outros vídeos que o app não toca para MP4 (precisa do ffmpeg). Veja [ferramentas](docs/ferramentas.md) |
| `npm run cli -- organizar <downloads> <biblioteca> --simular` | Arruma vídeos baixados na biblioteca com a ajuda do Jev (IA da TypeSafe; opcional, precisa de chave em `.env`, veja [ferramentas](docs/ferramentas.md#organizar)) |
| `npm run cli -- grade <biblioteca> --epoca 2004` | Monta o canal TV Gominho, no estilo da TV Globinho, com os programas da biblioteca (`grades/tv-gominho.yaml`) |
| `npm run cli -- servir <biblioteca> --abrir` | Abre o app já com a biblioteca (`--rede` para outros aparelhos da casa, `--editar` para salvar canais pelo app com um PIN, `--ia` para pedir canais ao Claude com a sua chave em `.env`; opcional, veja [ferramentas](docs/ferramentas.md#assistente-de-ia---ia)) |
| `npm run cli -- pendrive <biblioteca> -d E:\ -r 480` | Grava a programação em MP4 para tocar em qualquer TV; `verificar E:\` confere o resultado |
| `npm run pacote` | Monta o pacote portátil em `pacote/tv-gominho` (app, ferramenta, atalhos e instalador do Raspberry Pi) |
| `npm run cli -- ajuda` | Lista os comandos da linha de comando |
| `npm run comerciais` | Gera comerciais fictícios (anos 90/2000) em `vinhetas/comerciais` da biblioteca de domínio público; narração opcional via Piper (`-- --instalar-voz`) |
| `npm test` | Testes do núcleo (leitura da biblioteca e motor da grade) e da linha de comando |
| `npm run typecheck` | Verificação de tipos do TypeScript |
| `npm run build` | Gera a versão final em `pacotes/interface/dist` e a linha de comando em `pacotes/cli/dist` |

### Controles

| Tecla | Na TV | Na biblioteca |
|---|---|---|
| ↑ ↓ | Troca de canal (grades e programas) | Navega |
| ← → | Abre os ajustes rápidos | Navega (no player: volta/avança 10 s) |
| S | Abre os ajustes rápidos | No player: abre os ajustes rápidos |
| Enter / OK | Mostra o que está passando | Abre |
| Esc / Backspace | Abre o menu (e, com um painel aberto, fecha um nível) | Volta |
| 1–9 | Vai direto para o canal | |

O menu, os ajustes rápidos e as configurações são painéis **por cima da imagem**: a TV continua passando enquanto você mexe, e o efeito de cada ajuste aparece na hora. Veja [docs/configuracoes.md](docs/configuracoes.md#painéis-sobre-a-imagem).

## Licença

[GPL-3.0](LICENSE).

## Importante

- Este projeto **não distribui episódios, vinhetas nem marcas da Globo**. Cada pessoa usa os próprios arquivos.
- TV Gominho é um projeto independente de fãs, **sem afiliação com a Globo**. "TV Globinho" é marca de seus respectivos donos e aparece aqui só para descrever o que o projeto recria.

---

## English

TV Gominho is a FOSS player that recreates the experience of watching *TV Globinho*, a Brazilian kids' TV block, on an old CRT TV. It is an independent fan project, not affiliated with Globo. Users supply their own episode files; the app plays them following a historical broadcast schedule, with bumpers and a CRT effect, or lets you browse them on demand. Documentation is written in Brazilian Portuguese first; see [`docs/`](docs/).
