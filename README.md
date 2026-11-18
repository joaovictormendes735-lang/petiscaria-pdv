# Petiscaria · PDV

Sistema de caixa em português, com frontend em HTML/CSS/JavaScript puro, servidor Node.js e PostgreSQL. A página inicial é o caixa. Inclui fila de preparo, cadastro de produtos e categorias, relatório diário, autenticação e comandas não fiscais de 58/80 mm.

**Situação da entrega:** código implementado e testado localmente. A publicação e a conexão com um PostgreSQL de produção dependem de configurar a conta de hospedagem, a conexão do banco e o endereço HTTPS da sua loja. Não há banco remoto nem domínio provisionado neste pacote.

## Começar

Estes passos são feitos pelo responsável técnico no servidor ou computador de desenvolvimento. O atendente só abre o endereço HTTPS no navegador; não instala Node.js nem banco no notebook ou celular.

Requisitos do servidor: Node.js 22.13 ou superior (recomendado Node.js 24 LTS), npm e PostgreSQL 15 ou superior. As migrações exigem permissão para criar tabelas. Use um banco dedicado para a loja.

No terminal, dentro desta pasta:

```powershell
npm ci
Copy-Item .env.example .env
```

Edite `.env` e preencha `DATABASE_URL`. Para um PostgreSQL local, pode usar os dados do exemplo. Para um banco hospedado, siga a seção de implantação e habilite TLS.

```powershell
npm run db:migrate
npm run db:seed
npm run user:create
```

O último comando pergunta usuário, nome, perfil (`admin` ou `operator`) e senha. Crie primeiro um administrador e depois uma conta por operador. A senha deve ter entre 12 e 128 caracteres e é solicitada sem exibição no terminal. Não há senha padrão nem usuário criado pela carga de produtos.

```powershell
npm start
```

Abra [http://localhost:3000](http://localhost:3000). Para desenvolvimento com reinício automático do servidor, use `npm run dev`. Alterações de HTML/CSS/JS aparecem ao recarregar a página.

O comando `db:migrate` é transacional e pode ser repetido. `db:seed` cria quatro categorias e 14 produtos demonstrativos apenas quando ainda não há produtos. Os preços de demonstração devem ser revisados antes de vender.

## Publicar com HTTPS e PostgreSQL

Uma combinação compatível é **Neon PostgreSQL** e **Render Web Service com instância paga**, ou outro provedor comercial que execute Node.js continuamente. O banco Neon tem plano gratuito, sujeito a cotas e disponibilidade. O plano gratuito do Render suspende serviços por inatividade e sua documentação não o recomenda para produção; use uma instância sempre ativa no caixa real.

Consulte os planos e condições vigentes: [Neon](https://neon.com/pricing), [Render](https://render.com/pricing), [serviços Node.js](https://render.com/docs/web-services) e [limitações gratuitas](https://render.com/docs/free). O código usa a interface PostgreSQL comum e pode mudar de provedor sem trocar o frontend.

1. Crie um projeto PostgreSQL no Neon. Prefira a mesma região do servidor. Copie a conexão PostgreSQL para o painel seguro de variáveis do seu serviço. Uma conexão direta ou com pool compatível com transações pode ser usada; a aplicação limita seu pool a cinco conexões por instância.
2. Envie o conteúdo desta pasta para um repositório privado. Não envie `.env`, credenciais, `node_modules` ou arquivos de teste gerados.
3. Crie um Web Service Node.js no Render. O pacote inclui `render.yaml` como exemplo de configuração. Se este projeto estiver em uma subpasta do repositório, ajuste o Root Directory.
4. Configure o build: `npm ci --include=dev && npm run build`. Configure a preparação antes de cada implantação: `npm run db:migrate`. Configure o start: `npm start` e o health check: `/health`.
5. No painel do serviço, configure as variáveis abaixo. O `PORT` é fornecido pelo provedor. `APP_ORIGIN` deve ser a URL HTTPS exata, sem barra final, por exemplo `https://sua-petiscaria.onrender.com`.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
APP_ORIGIN=https://sua-petiscaria.onrender.com
DATABASE_URL=postgresql://USUARIO:SENHA@HOST/BANCO
DATABASE_SSL=require
SESSION_HOURS=12
TRUST_PROXY=0
```

Remova parâmetros `sslmode`, `sslcert`, `sslkey` e `sslrootcert` da URL antes de usá-la com `DATABASE_SSL=require`: o modo TLS da aplicação valida o certificado e esses parâmetros podem substituir a configuração SSL do driver. Preserve outros parâmetros exigidos pelo provedor. Não use `rejectUnauthorized=false`. Se o banco exigir uma CA particular, configure-a por `NODE_EXTRA_CA_CERTS` no servidor.

`TRUST_PROXY=0` é a opção conservadora: o limite por IP verá o proxy, mas continua existindo limite por usuário. Use `1` apenas se houver exatamente um proxy confiável à frente da aplicação, sem acesso público direto à porta Node, e ele sobrescrever `X-Forwarded-For` com o endereço real do visitante. Não habilite com cabeçalhos controláveis pelo cliente.

6. Na primeira implantação, abra o shell seguro do serviço, execute `npm run db:seed` e `npm run user:create`. Crie as contas da equipe. O comando de migração deve terminar com sucesso antes de abrir o caixa.
7. Abra a URL HTTPS em dois aparelhos, faça login com contas diferentes e realize uma venda de homologação. Atualize a fila no segundo aparelho. Teste a impressora real antes de começar a operação.

Para domínio próprio, adicione o domínio no painel do provedor, configure o DNS e aguarde a emissão do certificado HTTPS. Atualize `APP_ORIGIN` para esse domínio e reinicie o serviço. Use um único endereço oficial para o caixa, pois a proteção de origem bloqueia gravações por endereços alternativos.

Não é preciso que os aparelhos estejam na mesma rede Wi-Fi: eles precisam alcançar esse servidor HTTPS. Todos os pedidos são gravados no mesmo PostgreSQL. Botões **Atualizar** consultam alterações feitas por outros aparelhos; não há consulta constante em segundo plano.

### Docker opcional

O `Dockerfile` gera a interface minificada e instala apenas dependências de produção na imagem final.

```powershell
docker build -t petiscaria-pdv .
docker run --rm --env-file .env petiscaria-pdv npm run db:migrate
docker run --rm -it --env-file .env petiscaria-pdv npm run user:create
docker run --env-file .env -p 3000:3000 petiscaria-pdv
```

Para a imagem de produção, `.env` deve conter `NODE_ENV=production`, `HOST=0.0.0.0`, `APP_ORIGIN` HTTPS e a conexão acessível a partir do contêiner. Um proxy ou a plataforma de hospedagem termina o HTTPS; o processo Node recebe tráfego interno HTTP. `localhost` no contêiner é o próprio contêiner, não o banco do computador anfitrião.

## Usar no balcão

1. Entre com a conta do operador. O sistema abre no **Caixa**.
2. Selecione os produtos, filtre por categoria ou busque pelo nome. Ajuste quantidades com `+` e `−`. Cada produto permite até 99 unidades; um pedido pode ter até 100 produtos distintos.
3. Clique em **Finalizar venda**, selecione a forma de pagamento e confira o total. Em dinheiro, informe o recebido e confira o troco.
4. Confirme o recebimento e salve. Pix e cartão são registrados depois de você confirmar o pagamento na maquininha ou conta bancária; não há cobrança bancária integrada.
5. A senha aparece após a gravação no banco e o pedido entra como **Pendente**. Imprima a comanda.
6. Em **Pedidos**, avance para **Em preparo**, **Pronto** e **Entregue**. A fila padrão oculta pedidos entregues, que continuam nos filtros e no histórico.

**Falha de conexão:** o carrinho é mantido. Se o servidor não responder à confirmação, use **Verificar venda**. O sistema repete a mesma identificação e retorna a venda existente quando ela já foi salva. Não crie outro pedido para substituir uma confirmação incerta. Uma recarga da mesma aba preserva a tentativa enquanto o armazenamento de sessão do navegador estiver disponível. Fechar a aba pode apagar o rascunho; nesse caso, confira os pedidos antes de refazer a venda.

O sistema exige conexão para confirmar vendas. Não mantém uma fila offline de pagamentos. Se o navegador impedir o armazenamento de sessão, um aviso pede que a aba seja mantida aberta durante a confirmação.

Uma mudança de preço ou desativação em outro aparelho bloqueia a venda com os dados antigos. Atualize o catálogo, remova o item antigo do carrinho e adicione novamente pelo preço atual. Pedidos já salvos preservam nome e preço originais.

As senhas são numéricas, globais e geradas atomicamente por sequência PostgreSQL, sem reiniciar a cada dia. São únicas mesmo em vários dispositivos. Como em sequências PostgreSQL comuns, transações abortadas ou conflitos podem deixar lacunas. O sistema não recicla números e não promete uma numeração sem lacunas.

## Impressão térmica de 58 e 80 mm

1. Instale e teste o driver da impressora no Windows, ou conecte uma impressora compatível com os recursos de impressão do Android/iPhone. A compatibilidade depende do modelo, driver e sistema operacional; uma impressora Bluetooth genérica pode não aparecer no navegador do celular.
2. Entre como administrador em **Configurações**. Ajuste o nome da loja e a largura do papel. Use **Imprimir teste**.
3. Na janela do navegador, selecione a impressora, papel correspondente, escala de 100% e remova cabeçalhos e rodapés. A comanda usa área útil de 52 mm no papel de 58 mm e 72 mm no papel de 80 mm.
4. Configure o comprimento do recibo ou corte automático no driver. O navegador não controla comandos ESC/POS ou a guilhotina. Margens e corte podem exigir ajuste conforme o modelo.
5. Se desejar, marque **Abrir impressão após salvar a venda**. A janela do navegador será aberta depois da confirmação da gravação. Não há impressão silenciosa.

Para reimprimir, use o ícone de impressora em **Pedidos** ou **Relatórios**. Cancelar a impressão não desfaz a venda. Se o navegador móvel não oferecer a impressão, use outro aparelho conectado ao mesmo sistema para reimprimir. A impressão não exige uma instalação especial do PDV, mas depende da configuração de impressão do dispositivo.

O comprovante é **não fiscal**. A solução não emite NFC-e, não integra adquirentes, não cancela/refunda vendas concluídas e não oferece controle de estoque. O botão de limpar remove apenas o pedido ainda não vendido.

## Contas e segurança

| Perfil | Permissões |
| --- | --- |
| Operador | Caixa, pagamentos registrados, fila de pedidos e reimpressão |
| Administrador | Tudo do operador, produtos, categorias, relatórios e configurações |

As permissões são verificadas no servidor. Senhas usam scrypt com salt individual. Cookies de sessão são HttpOnly, SameSite=Strict e Secure em produção; o banco armazena apenas o hash do token. Sessões expiram em até 12 horas por padrão, configuráveis entre 1 e 24 horas. Há proteção CSRF, validação de origem, consultas parametrizadas, limite de tentativas de login e cabeçalhos de segurança.

Valores são inteiros em centavos. O servidor recalcula preços a partir de produtos ativos e exige que os valores confirmados correspondam ao catálogo. Venda, itens e registro de auditoria são gravados em uma transação. Uma chave única por confirmação impede duplicação, inclusive se a resposta se perder depois do commit.

Gerencie contas por terminal seguro no servidor:

```powershell
npm run user:create
node --env-file-if-exists=.env scripts/manage.js reset
node --env-file-if-exists=.env scripts/manage.js disable
```

`reset` altera a senha e revoga sessões. `disable` desativa a conta, revoga sessões e bloqueia a desativação do último administrador ativo. Para reativar uma conta, o responsável técnico deve usar acesso administrativo ao banco; não há painel público de recuperação de senha.

Use credenciais individuais e restrinja o acesso ao banco e ao shell. Não publique `.env`. A tabela `audit_log` registra operações de venda, status e alterações administrativas. Defina retenção e cópias de segurança conforme a rotina da loja. Sessões e tentativas expiradas são limpas no login, sem tarefas de atualização contínua.

## Backups, atualizações e operação

- Ative backups no provedor. Se o plano não incluir restauração suficiente, agende `pg_dump` em infraestrutura do responsável técnico, com credenciais no gerenciador de segredos ou arquivo de senhas protegido. Guarde o backup fora do serviço e ensaie a restauração em outro banco.
- Antes de atualizar, faça backup. Execute migrações uma vez, valide `/health` e só depois libere o caixa. Não apague/recrie tabelas em um banco que já tenha vendas.
- Monitore disponibilidade, armazenamento, limites do plano gratuito do banco e erros do servidor. A resposta de erro público não revela SQL ou credenciais.
- Reiniciar o Node não perde vendas, pois elas ficam no PostgreSQL. O disco do serviço não é usado para dados operacionais.
- O uso real em produção requer homologar o banco contratado, o domínio HTTPS e a impressora do estabelecimento. O pacote não provisiona contas de serviços nem assume sua cobrança.

## Testes e desempenho

```powershell
npm ci
npm test
npm run build
npm run test:browser
npm audit --omit=dev
```

Os testes de integração usam PostgreSQL embarcado via PGlite, somente em desenvolvimento. Ele serializa transações em uma conexão e não substitui homologação de concorrência em um PostgreSQL remoto com várias conexões reais. O código de produção usa `pg.Pool`, sequência nativa e restrição única para idempotência.

Os testes de navegador usam Edge/Chrome instalado no ambiente de desenvolvimento. Para outro executável, defina `BROWSER_PATH`. Se não houver navegador local, use `npx playwright install chromium` no computador de desenvolvimento. O teste inicia um servidor temporário, cria contas apenas no banco de teste, executa o fluxo e encerra o servidor. Porta padrão: 43821; pode ser alterada por `BROWSER_PORT`.

`npm run build` minifica JS/CSS, mede o tamanho gzip e falha se a interface inicial ultrapassar 150 KB. A medição desta entrega foi **aproximadamente 15 KB gzip**. O frontend não carrega bibliotecas, fontes, fotos nem serviços externos. Os relatórios e pedidos usam páginas de 50 registros; não há gráficos pesados, polling ou service worker.

Veja `TESTES.md` para resultados e limites da verificação. PDFs e capturas gerados por `test:browser` ficam em `.test-data/` e não contêm vendas reais.

## Organização

```text
public/             HTML, CSS e JavaScript sem framework
src/app.js          Rotas, autenticação, permissões e regras de negócio
src/db.js           Pool PostgreSQL e transações
src/security.js     Senhas e tokens
src/server.js       Inicialização e encerramento do servidor
db/001-init.sql     Esquema e migração inicial
scripts/manage.js  Migração, produtos de exemplo e contas
scripts/build.js   Minificação e orçamento de tamanho
test/               Testes de integração e navegador
dist/               Interface minificada gerada
.env.example        Variáveis de configuração sem credenciais reais
Dockerfile          Imagem para hospedagem Node.js
render.yaml         Exemplo de implantação comercial no Render
```
