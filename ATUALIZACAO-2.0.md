# Atualização 2.0

Esta versão amplia o mesmo projeto Node.js/PostgreSQL com HTML, CSS e JavaScript puro. Não troca a tecnologia nem reinicia o banco. O cardápio, as contas, as vendas e as senhas anteriores são preservados.

## O que mudou

- Interface com navegação lateral no notebook, navegação em grade no celular, paleta clara, SVGs pequenos e fontes do sistema.
- Administrador entra em Visão geral; operador entra no Caixa. O carrinho continua disponível ao navegar e o rascunho fica na mesma aba.
- Atalhos sem modificadores: F2 busca, F4 finalização, Esc fecha a janela. Ctrl/Alt/Meta/Shift não são interceptados.
- Observações de até 500 caracteres, subtotal e desconto em reais concedido exclusivamente por administrador. A validação e o cálculo final são feitos no servidor.
- Pagamento com itens, total, observações e troco. **Confirmar e imprimir** salva primeiro; **Confirmar sem imprimir** aparece quando a impressão obrigatória por preferência está desativada.
- Comandas com observações, desconto e mensagem personalizada, além de pré-visualização e reimpressão em 58/80 mm.
- Pedidos agrupados em pendentes, em preparo, prontos e entregues. Tempo decorrido é calculado ao carregar; esperas de 15 minutos ou mais são destacadas sem animação. O botão Atualizar consulta mudanças dos outros aparelhos.
- Painel público independente em `/retirada`, com senhas prontas e as últimas dez chamadas nas últimas 24 horas. Não exibe itens, observações, pagamentos, valores ou pessoas. Consulta a cada 15 segundos enquanto a página está visível, sem consultas sobrepostas.
- Produto com ordem de exibição, situação ativa e disponibilidade separadas. Produto indisponível aparece identificado e desabilitado no caixa; o servidor também bloqueia a venda. A exclusão pede confirmação e é lógica: mantém o produto e os vínculos históricos no banco.
- Histórico paginado com número, data, detalhes e reimpressão. Operador consulta seu próprio histórico; administrador consulta todos os registros.
- Cancelamento administrativo com motivo e responsável, sem apagar pedidos ou itens. Pedidos cancelados saem da fila e dos totais de vendas válidas.
- Dashboard com faturamento, quantidade, ticket médio, pagamentos e dez produtos mais vendidos, sem biblioteca de gráficos.
- Personalização de nome, logomarca, cor, dados básicos, mensagem da comanda, mensagem de retirada e impressora. Imagens PNG/JPEG/WebP limitadas a 32 KB; texto de botões adapta o contraste da cor escolhida.

## Controle de caixa

O caixa é um expediente compartilhado por todos os dispositivos da loja. Só pode existir um expediente aberto por vez. A abertura registra operador, data, horário e dinheiro inicial. Qualquer venda nova é vinculada ao expediente aberto.

Em **Controle de caixa**, abra o expediente antes de começar. Ao fechar, informe o dinheiro físico contado. O esperado em dinheiro é **saldo inicial + total líquido de vendas em dinheiro**. Pix e cartões são informados separadamente; o valor recebido acima do total é troco, não receita extra.

Quem abriu o caixa ou um administrador pode encerrá-lo. O servidor bloqueia o fechamento enquanto uma venda já vinculada estiver sendo concluída, evitando perda de valores por concorrência. A tela lista fechamentos anteriores, com os responsáveis, contado, esperado, diferença e resumo imprimível.

Por compatibilidade, a exigência de caixa aberto começa **desativada** na atualização. Ative **Configurações → Exigir abertura de caixa para registrar vendas** se quiser bloquear vendas fora do expediente. Vendas anteriores à versão 2.0 não são vinculadas retroativamente a um expediente; continuam nos relatórios e no histórico.

Fechamentos são fotografias dos valores na hora do encerramento. Um administrador pode cancelar uma venda depois do fechamento, mas o resumo já fechado não é reescrito; a ação é registrada como cancelamento posterior ao fechamento. O relatório diário líquido passa a excluir a venda cancelada. Qualquer devolução efetiva em dinheiro ou estorno na maquininha/Pix é realizada fora do sistema e deve ser reconciliada pelo responsável.

## Migração e proteção dos dados

`db/001-init.sql` permanece intacto. `db/002-v2.sql` acrescenta colunas, índices e a tabela `cash_sessions`; não remove ou regrava vendas. O subtotal de vendas antigas é obtido a partir do total existente quando necessário. A sequência original de senhas continua no mesmo escopo global.

`npm run db:migrate` aplica apenas versões pendentes, em uma transação e com bloqueio do registro de migrações. Pode ser repetido sem duplicar alterações. O servidor 2.0 exige a migração 2 antes de iniciar. Em hospedagem com preparação de deploy, execute a migração antes da troca da aplicação; no plano gratuito, aplique pelo responsável técnico antes do deploy.

Uma cópia consistente das tabelas operacionais foi salva fora do repositório antes da migração. Tokens, senhas de conexão e esse backup privado não fazem parte do código publicado. Na implantação, foram comparados os registros anteriores e seus valores após a migração.

### Plano de reversão

Antes de usar funções 2.0, a migração aditiva é compatível com o servidor anterior; em caso de falha no deploy, a versão anterior pode continuar atendendo com as colunas adicionais. Não remova colunas nem tabelas para reverter a interface.

Depois de haver cancelamentos, descontos ou expedientes da versão 2.0, prefira uma correção incremental. A versão 1.0 não compreende as novas regras financeiras e não deve voltar a operar sobre esses registros. Se for necessária uma reversão completa, interrompa novas operações, preserve também um backup do estado atual, restaure a cópia anterior em **outro banco**, valide valores e senhas e só então troque a conexão e a versão da aplicação. Nunca apague o banco atual para tentar recuperar a versão anterior. Guarde as operações posteriores para reconciliação.

## Verificação

- **23 testes de integração:** inclui regressão das vendas 1.0, migração, permissões, descontos, observações, cancelamentos, abertura/fechamento, disponibilidade e privacidade do painel público.
- **17 verificações no navegador:** dinheiro, Pix, débito, crédito, troco, impressão de 58/80 mm, reimpressão, foco/atalhos, cadastro, histórico, cancelamento, caixa, retirada em TV/celular e falha de resposta após o commit.
- **PostgreSQL real com cinco conexões:** vinte pedidos concorrentes com números distintos; doze repetições de confirmação sem duplicação; cinco atualizações concorrentes de status; preço adulterado rejeitado; venda concorrente com fechamento respeitando o resumo financeiro.
- Interface inicial minificada: aproximadamente **25 KB gzip**, somando HTML, CSS, dois scripts e ícone. A cor e a logomarca são dados dinâmicos. O build mantém a barreira de 150 KB.
- Capturas de notebook/celular e do painel de TV, além das comandas, foram inspecionadas.

Os testes de dados novos usam bancos temporários ou esquema isolado, sem inserir vendas de homologação no caixa da loja. A migração preserva as vendas existentes. A impressora física e o acesso em Safari/iPhone real precisam de verificação no estabelecimento; as telas móveis foram verificadas no Chromium.

## Configuração depois de atualizar

1. Atualize a página do navegador para carregar os novos scripts.
2. Em Configurações, ajuste nome, logomarca, cor, dados e mensagens.
3. Se desejar, habilite a abertura obrigatória e abra o primeiro expediente.
4. Abra `/retirada` na TV ou em outro dispositivo. O endereço é público e não pede a conta de administrador.
5. Confira o papel no sistema e no driver, imprima uma comanda e um fechamento reais. Navegadores comuns mostram a janela de impressão; não há impressão silenciosa.

O domínio HTTPS, as credenciais existentes e o PostgreSQL permanecem os mesmos. A hospedagem gratuita do Render pode suspender o serviço por inatividade; uma operação contínua no balcão deve usar uma instância sempre ativa.
