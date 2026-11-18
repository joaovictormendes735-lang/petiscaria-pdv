# Verificação da entrega

Resultados da versão **2.0**: 23 testes de integração, 17 verificações de navegador e homologação concorrente no PostgreSQL Neon. Consulte `ATUALIZACAO-2.0.md` para a lista atual e a verificação de preservação dos dados. Os resultados abaixo documentam a entrega 1.0.

Executada em 18/11/2026, com Node.js 24 e navegador Microsoft Edge/Chromium no Windows.

## Integração

`npm test`: **12 testes aprovados**, com banco PostgreSQL embarcado PGlite temporário.

- Login, cookie HttpOnly/SameSite, rotas protegidas, origem e CSRF.
- Permissões de administrador e operador verificadas no servidor.
- Venda com total e troco em centavos, itens históricos e entrada na fila.
- Oito confirmações simultâneas com a mesma chave geram uma única venda.
- Doze pedidos distintos enviados por duas sessões recebem números únicos.
- Preço adulterado, total incorreto, quantidades inválidas, itens duplicados e dinheiro insuficiente são rejeitados.
- Transições da fila e proteção contra cliques com status desatualizado.
- Categorias, produtos, desativação e preservação do preço histórico.
- Relatório diário, totais por pagamento e validação de datas.
- Persistência de configurações de nome, fuso, impressão automática e largura.
- Limites de dia no fuso America/Sao_Paulo e paginação de mais de 50 pedidos sem repetição.
- Logout revoga a sessão; tentativas incorretas de login sofrem bloqueio persistente no banco.

## Navegador

`npm run test:browser`: **10 verificações aprovadas**, usando a interface minificada.

- Login e caixa em 1440 px.
- Venda de batata e dois refrigerantes: total de R$ 37,00, recebido R$ 50,00, troco R$ 13,00 e limpeza do carrinho depois da gravação.
- Botão chama `window.print`; CSS de impressão esconde o sistema e deixa apenas a comanda de 80 mm.
- Fila percorrida de pendente até entregue.
- Cadastro de produto persistido e exibido na tabela.
- Relatório mostra a venda e seu pagamento.
- Impressão de teste em 58 mm com área útil de 52 mm.
- Simulação de resposta de rede perdida **depois** do commit: recarga da página e nova confirmação retornam a mesma venda sem duplicá-la.
- Tela de 390 px sem rolagem horizontal, carrinho fixo acessível e venda concluída.
- Nenhum erro JavaScript não tratado durante o fluxo.

Foram gerados PDFs e capturas de impressão de 58/80 mm, além de capturas de desktop e celular. As capturas foram inspecionadas visualmente.

## Tamanho e dependências

- Build minificado: aproximadamente **15 KB gzip** para HTML, CSS, JavaScript e ícone juntos, excluindo os dados dinâmicos.
- Meta automática do build: menos de 150 KB gzip.
- `npm audit --omit=dev --audit-level=moderate`: **nenhuma vulnerabilidade conhecida nas dependências de produção** na data da verificação.

## Limites

Na etapa de publicação, também foi feita homologação no PostgreSQL real do Neon, com TLS e cinco conexões independentes. O teste `test/postgres.js` criou um esquema isolado e o removeu ao final, sem adicionar vendas às tabelas da loja. Resultado: 20 pedidos simultâneos com números distintos; 12 confirmações repetidas com uma única venda; cinco alterações simultâneas de status com apenas uma aceita; preço adulterado rejeitado.

Para repetir, configure `TEST_DATABASE_URL` com a conexão **direta, sem pooler**, em um arquivo `.env` protegido, e execute `npm run test:postgres`. A conta precisa de permissão para criar e remover esquemas. Não configure essa variável no serviço web de produção.

A publicação HTTPS e a impressão em equipamento físico ainda dependem da conclusão da hospedagem e da homologação local da impressora. Os 12 testes padrão continuam usando PGlite; a homologação adicional acima verifica a contenção real entre conexões PostgreSQL independentes.

O layout móvel foi testado no Chromium com viewport de celular; não houve execução em aparelhos Android/iPhone físicos ou Safari. Os PDFs verificam a renderização do recibo, mas não o driver, corte automático ou compatibilidade Bluetooth/AirPrint. Siga o roteiro abaixo antes do primeiro turno de uso.

## Homologação no estabelecimento

1. Configure o banco real, domínio HTTPS, variáveis de produção e contas individuais.
2. Faça uma venda em cada forma de pagamento e confira totais e troco.
3. Use dois aparelhos para enviar pedidos simultaneamente e confirmar que as senhas são diferentes.
4. Confirme que um clique repetido ou reenvio da mesma tentativa mantém um único pedido.
5. Confira o pedido no segundo aparelho após usar Atualizar e avance os estados da fila.
6. Imprima na térmica real, ajuste driver e papel e teste reimpressão.
7. Confira o relatório no fuso da loja e a virada do dia.
8. Faça backup e teste restauração em um banco separado antes de depender do sistema.
