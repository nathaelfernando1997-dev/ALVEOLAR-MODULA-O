# Alveolar Modulação

Sistema para desmembrar as paredes de um projeto em **painéis alveolares** a partir da planta em **DXF**.

O arquivo é lido no próprio navegador (não vai para servidor). Os ajustes de cada projeto ficam salvos no navegador e podem ser exportados em JSON.

## Como usar

1. **Arquivo** – abra o DXF (no AutoCAD: *Salvar como → DXF*) e confira a camada das paredes.
2. **Desenhos** – diga o que é cada desenho: planta baixa (com nome e pé-direito) ou corte. A ordem define a numeração.
3. **Portas e janelas** – confira o quadro de aberturas lido do projeto.
4. **Regras** – largura máxima, coluna, desconto, bonecas e acréscimos dos recortes.
5. **Paredes** – revise na planta baixa: clique numa parede para excluir (shaft, platibanda, torre), pinar no T (passar direto, sem emenda), não dividir, cortar em pontos manuais ou mudar a altura; clique num vão para dizer se é porta, janela ou vão livre.
6. **Lajes** – painéis por ambiente, vencendo o menor vão entre paredes, com apoio em cima de cada parede; tire a laje de vazios/áreas externas ou gire o sentido.
7. **Cortes** – marque os cortes na aba Desenhos; o sistema lê as cotas verticais e confere pés-direitos, laje e alturas de portas/janelas.
8. **Impressão e arquivos** – folhas A4 (planta de montagem, vistas dos painéis e lajes), DXF da modulação, lista de painéis em CSV e os ajustes em JSON.

## Regras padrão

- Largura máxima 3,50 m; paredes maiores são divididas em partes iguais com coluna de 15 cm.
- No encontro em T a coluna fica só na parede que segue alinhada.
- 5 cm a menos em cada painel.
- Recortes: +10 cm na largura; porta = boneca 0,10 + altura do quadro; janela desce 5 cm abaixo do peitoril e sobe 5 cm acima.
- Boneca de 10 cm nas laterais e embaixo dos recortes (retirada na obra).
- T pinado (opcional, automático ou parede a parede): a parede contínua passa sem coluna e a outra é pinada nela.
- No T a parede que chega para na face da que passa; pedaço menor que 0,50 m é pinado no vizinho.
- Porta mais alta que o pavimento: o vão continua no pé da parede de cima.
- Viga sobre vão: altura de 10% do vão (mínimo da regra); usa o espaço acima da porta e a laje, e o restante sobe — as paredes de cima apoiam na viga e ficam mais baixas (até 10 cm não baixa: reforça a ferragem).
- Laje: vão máximo 5,00 m (pode ser menor), largura máxima 3,00 m, folga de 2 cm entre painéis vizinhos, apoio em cima das paredes em todos os lados: 6 cm onde a parede recebe laje dos dois lados e 10 cm onde só uma laje apoia; a laje apoia nas paredes (inclusive internas) e o sentido é escolhido para usar menos vigas; beiral até 1,00 m sem viga.
- Projeto: "LINHA DE PISO" vira viga de apoio da laje; linhas de "PROJ. LAJE / COBERTURA / BEIRAL" marcam até onde a laje vai (beiral nas pontas dos painéis); áreas escritas "VAZIO" no pavimento de cima ficam sem laje.
- Vigas sugeridas: vão sem parede onde a laje apoia ou com parede em cima (obrigatória acima de 5,00 m); laje com vão maior que o painel mesmo usando as paredes. Paredes de cima sobre a laje não levam viga: a laje é reforçada com treliças embaixo delas.

## Desenvolvimento

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # gera dist/ (site estático)
npm run test:ricardo -- caminho/do/projeto.dxf   # roda o motor no terminal
```

Publicação: qualquer hospedagem de site estático (ex.: Vercel, framework "Vite", pasta `dist`).

## Nuvem e login (Supabase)

Sem configuração, os projetos ficam salvos só no navegador. Para salvar na nuvem com login:

1. Crie um projeto no [Supabase](https://supabase.com) (separado do ESTRUTTURA).
2. No **SQL Editor**, rode o arquivo [`supabase/schema.sql`](supabase/schema.sql) (cria a tabela `projetos` e o armazenamento dos DXF, cada usuário só vê os seus).
3. Em **Authentication → URL Configuration**, coloque o endereço do site em *Site URL* (ex.: `https://alveolar-modula-o.vercel.app`).
4. Na Vercel, em **Settings → Environment Variables**, crie:
   - `VITE_SUPABASE_URL` = *Project URL* (Supabase → Project Settings → API)
   - `VITE_SUPABASE_ANON_KEY` = chave *anon public*
5. Faça um novo deploy. O site passa a pedir login; os projetos que estavam só no navegador podem ser enviados para a nuvem pelo botão na aba Arquivo.
