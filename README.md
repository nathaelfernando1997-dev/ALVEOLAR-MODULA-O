# Alveolar Modulação

Sistema para desmembrar as paredes de um projeto em **painéis alveolares** a partir da planta em **DXF**.

O arquivo é lido no próprio navegador (não vai para servidor). Os ajustes de cada projeto ficam salvos no navegador e podem ser exportados em JSON.

## Como usar

1. **Arquivo** – abra o DXF (no AutoCAD: *Salvar como → DXF*) e confira a camada das paredes.
2. **Pavimentos** – marque as plantas baixas, dê nome e pé-direito. A ordem define a numeração.
3. **Portas e janelas** – confira o quadro de aberturas lido do projeto.
4. **Regras** – largura máxima, coluna, desconto, bonecas e acréscimos dos recortes.
5. **Modulação** – revise na planta: clique numa parede para excluir (shaft, platibanda), juntar com a próxima, não dividir, cortar em pontos manuais ou mudar a altura; clique num vão para dizer se é porta, janela ou vão livre.
6. **Impressão e arquivos** – folhas A4 (planta de montagem e vistas dos painéis), DXF da modulação, lista de painéis em CSV e os ajustes em JSON.

## Regras padrão

- Largura máxima 3,50 m; paredes maiores são divididas em partes iguais com coluna de 15 cm.
- No encontro em T a coluna fica só na parede que segue alinhada.
- 5 cm a menos em cada painel.
- Recortes: +10 cm na largura; porta = boneca 0,10 + altura do quadro; janela desce 5 cm abaixo do peitoril e sobe 5 cm acima.
- Boneca de 10 cm nas laterais e embaixo dos recortes (retirada na obra).

## Desenvolvimento

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # gera dist/ (site estático)
npm run test:ricardo -- caminho/do/projeto.dxf   # roda o motor no terminal
```

Publicação: qualquer hospedagem de site estático (ex.: Vercel, framework "Vite", pasta `dist`).
