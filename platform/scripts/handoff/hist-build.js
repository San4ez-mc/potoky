// conversationHistory — вікно останніх повідомлень цієї сесії (user/assistant), яке будує двигун.
// Останнє в ньому — поточний запит користувача (він іде окремо як userMessage), тож відкидаємо його.
// Без цього у Telegram диспетчер не бачив попередніх реплік (context.history був порожній), і «візьми другу тему»
// чи «а ще один» не працювали — історію передавав лише дашборд.
if (Array.isArray(context.history) && context.history.length && !context.histFromSession) {
  return {}; // історію передав дашборд — вона в пріоритеті
}
var arr = Array.isArray(conversationHistory) ? conversationHistory.slice() : [];
if (arr.length && arr[arr.length - 1].role === 'user') arr.pop();
return { history: arr.slice(-10), histFromSession: true };
