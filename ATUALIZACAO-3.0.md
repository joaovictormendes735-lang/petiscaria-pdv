# Atualização operacional 3.0

Atualização do mesmo PDV Node.js/PostgreSQL, preservando o cadastro, as vendas, os números de pedidos e a autenticação. As migrações 001 e 002 permanecem intactas; `003-operations.sql` acrescenta os dados operacionais necessários.

## Operar os recursos novos

### Combos

Em **Produtos → Novo combo**, informe nome, categoria, preço único e componentes com quantidades. Use produtos individuais ativos; não há combos dentro de combos. O combo pode ter de 1 a 30 componentes distintos, com até 99 unidades de cada um.

Ao vender, o servidor cobra o preço do combo e salva uma cópia da composição. Alterações futuras de nome, preço ou composição não mudam as comandas já emitidas. O caixa bloqueia um combo quando ele ou um de seus componentes está esgotado, desativado ou excluído. A venda também valida isso no servidor, dentro da transação.

Os combos promocionais reais precisam ser cadastrados pelo administrador. Nenhum combo ou preço do exemplo foi incluído automaticamente no cardápio da loja.

### Observações

O carrinho e a finalização têm botões **Sem cebola**, **Sem gelo**, **Bem passado**, **Molho extra**, **Sem sal** e **Outras observações**. Os botões acrescentam texto à observação; a última opção foca o campo livre.

Cada linha do carrinho tem **Observação do item**, com até 200 caracteres. A observação é compartilhada pela quantidade daquela linha. Observações gerais permitem até 500 caracteres. Os textos são escapados na interface e nas comandas.

### Guardar pedidos

Em **Guardar pedido**, dê uma identificação curta e confirme. O pedido vai para uma tabela de rascunhos no servidor, sem pagamento, venda ou consumo de senha. O carrinho é liberado somente depois da gravação confirmada.

Use **Pedidos guardados → Retomar** com o carrinho vazio. Os preços são atualizados pelo catálogo atual e itens indisponíveis exigem revisão. O operador acessa seus próprios pedidos; o administrador pode acessar todos. O mesmo rascunho não pode gerar duas vendas, mesmo quando aberto em dois dispositivos. A finalização bloqueia o rascunho e grava o vínculo único com a venda atomicamente.

Guardar novamente um pedido retomado exige a versão esperada, protegendo contra substituição de alterações de outra tela. O descarte é lógico e registrado na auditoria. Em falha de resposta, repita a mesma confirmação sem alterar os dados antes de conferir a lista.

### Pagamento misto

Na finalização, escolha **Pagamento misto**, distribua o valor entre duas a quatro formas e informe o recebido na parcela em dinheiro, quando houver. A soma das parcelas deve ser exatamente o total líquido da venda. Cada método aparece no máximo uma vez.

O servidor valida parcelas, total, desconto e recebimento em centavos. Só dinheiro pode gerar troco; Pix e cartões devem corresponder exatamente às suas parcelas. O relatório diário e o caixa somam os valores efetivos de cada forma, sem contar um pedido misto duas vezes. Vendas antigas sem parcelas continuam sendo contabilizadas pelo pagamento original.

O sistema registra a confirmação do operador. Ele não efetua cobranças, transferências ou estornos bancários e não armazena dados de cartões.

### Sangria e suprimento

No **Controle de caixa** aberto, o administrador pode registrar suprimento ou sangria com valor e motivo. O servidor registra horário e responsável, limita sangria ao saldo esperado e protege cada confirmação com chave única. Operadores não podem criar essas movimentações.

Dinheiro esperado = **abertura + vendas líquidas em dinheiro + suprimentos − sangrias**. Troco e parcelas em Pix/cartões não aumentam indevidamente o dinheiro físico.

A movimentação bloqueia o mesmo expediente usado pelo fechamento. Se o fechamento ocorrer primeiro, novas movimentações são rejeitadas. Se a movimentação ocorrer primeiro, ela entra no resumo. Uma resposta perdida pode ser verificada com a mesma chave, inclusive após o fechamento. A tela oferece **Verificar movimentação pendente** quando necessário. O fechamento já emitido permanece imutável.

### Tempo, disponibilidade e impressão

Em **Configurações**, ajuste os limites: atenção de 1 a 180 minutos e atraso maior que atenção, até 480 minutos. Os valores iniciais são 10 e 20 minutos. A tela de pedidos mostra **Normal**, **Atenção** ou **Atrasado** desde a confirmação, com bordas discretas. O tempo é recalculado ao carregar/atualizar a tela, sem animação ou consultas adicionais contínuas.

Na lista de Produtos, **Esgotar** e **Disponibilizar** alteram a disponibilidade sem abrir o formulário completo. A função exige administrador e gera auditoria.

Na finalização, confirmação de venda ou pré-visualização, escolha **Comanda do cliente** ou **Comanda da cozinha**. A cozinha mostra número, horário, quantidades, composição dos combos e observações, sem valores ou pagamentos. O cliente recebe produtos, preço, total, parcelas quando mistas e mensagem de retirada. Os dois modelos usam o papel configurado de 58 ou 80 mm e são reimprimíveis sem nova venda.

## Backup autorizado

Em **Configurações → Exportar backup autorizado**, o administrador baixa um arquivo NDJSON. O servidor usa uma transação de leitura repetível e cursores de 200 registros por bloco: não carrega todo o histórico em memória de uma vez.

O arquivo contém manifesto, tabelas operacionais, sequências e uma linha final `{"type":"complete","complete":true}`. Guarde somente exportações concluídas. Download interrompido não constitui backup válido.

Inclui contas sem senha, categorias, produtos, componentes de combos, configurações, caixas, rascunhos, vendas, itens, movimentações e auditoria. Não inclui hashes de senha, sessões, CSRF, tentativas de login ou credenciais de hospedagem/banco. Como contém histórico financeiro e observações, deve ser guardado em local protegido. A exportação é registrada na auditoria.

É um backup operacional para restauração técnica em outro banco compatível. Não há botão de importação automática no caixa. Para restaurar, aplique o esquema correspondente, recupere os dados respeitando chaves e sequências, redefina as senhas das contas e valide totais e vínculos antes de trocar a aplicação para esse banco. A exportação não substitui backups e recuperação do provedor PostgreSQL.

Não existe exclusão definitiva de vendas pelo operador; o cancelamento administrativo anterior continua preservando os registros.

## PWA e conexão

O sistema tem manifesto, ícones PNG de 192/512 e service worker. No Chrome/Edge/Android, use **Instalar aplicativo** ou **Adicionar à tela inicial**, conforme a versão do navegador. No iPhone/iPad, abra no Safari e use **Compartilhar → Adicionar à Tela de Início**. A instalação depende do navegador e não ocorre automaticamente.

O worker guarda exclusivamente uma lista fechada de JavaScript, CSS, ícones, manifesto e a página estática de indisponibilidade. Não guarda APIs, temas dinâmicos, respostas autenticadas, vendas ou dados de pagamento. Arquivos estáticos usam rede primeiro; a navegação offline mostra **Sem conexão**. Não há fila de vendas pagas offline nem sincronização automática de pagamentos.

Um carrinho ou uma confirmação pendente na mesma aba continua sendo um rascunho, nunca uma venda concluída. Quando voltar a conexão, verifique a confirmação e o histórico antes de refazer uma venda.

Ao atualizar uma instalação futura, feche as abas/janelas antigas do PDV e abra novamente. O worker não força a substituição de uma instância que ainda está em uso no meio de uma operação.

## Dados, migração e reversão

Antes da migração, foi criado um backup privado consistente, separado do repositório e sem exposição pública. A migração acrescenta campos, tabelas e índices, amplia a restrição de pagamento para aceitar misto e não remove registros financeiros existentes. As senhas de pedidos continuam na sequência original. A atualização preserva as impressões digitais de confirmações das versões 1 e 2.

A migração pode ser aplicada com `npm run db:migrate` e executada novamente sem duplicar alterações. O servidor 3.0 exige a versão 3 do esquema. No plano gratuito do Render, a migração deve ser aplicada antes da publicação pelo responsável técnico; em planos com preparação de deploy, use o comando de migração nessa etapa.

Antes de usar recursos 3.0, a versão anterior pode continuar sobre o esquema ampliado em caso de problema de publicação. Depois de existirem pagamentos mistos ou movimentações, não volte a operar com a aplicação 2.0: ela não calcula os novos registros. Prefira uma correção incremental. Para reversão completa, interrompa novas operações, preserve também o estado mais recente, restaure o backup anterior em outro banco e reconcilie as operações posteriores. Não apague o banco atual para reverter a interface.

## Verificação e limites

- 37 testes de integração, incluindo os 23 testes anteriores e 14 cenários novos.
- 17 verificações de navegador dos recursos anteriores, mais 12 verificações operacionais 3.0.
- PostgreSQL real com cinco conexões: vendas simultâneas, reenvios, pedido suspenso retomado em oito confirmações concorrentes, combo com pagamento misto, movimentação repetida e corrida de venda/movimentação com fechamento.
- Comanda da cozinha de 58 mm e capturas do layout móvel foram inspecionadas; os modelos térmicos anteriores de 58/80 mm continuam na regressão.
- PWA testada no Chromium: cache apenas estático, página offline e ausência de vendas novas durante a falha de conexão.
- Interface e recursos PWA: aproximadamente **43 KB gzip**, abaixo da meta de 150 KB, sem frameworks novos.

As verificações novas usam banco temporário ou esquema isolado, sem inserir vendas de teste no caixa real. A homologação do equipamento físico ainda deve conferir impressão/corte, papel, sistema de impressão móvel e instalação PWA nos aparelhos Android/iPhone/notebook usados pela equipe.

A hospedagem continua no plano gratuito do Render. Suspensão por inatividade e limites do plano do banco são características da hospedagem; para atendimento contínuo no balcão, use instância sempre ativa.
