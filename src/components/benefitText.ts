import type { DictKey, I18n } from '@/lib/i18n';
import { PMMVY_CATEGORIES } from '@/lib/scheme/pmmvy';
import type { QuestionId } from '@/lib/scheme/types';

export function optionLabel(t: I18n['t'], questionId: QuestionId, value: string): string {
  switch (value) {
    case 'yes':
      return t('yes');
    case 'no':
      return t('no');
    case 'first':
      return t('opt_first');
    case 'second':
      return t('opt_second');
    case 'third_or_later':
      return t('opt_third_or_later');
    default:
      return questionId === 'second_child_girl' ? t('opt_girl_unsure') : t('notSure');
  }
}

export const QUESTION_TEXT: Record<QuestionId, DictKey> = {
  pregnant_or_recent_birth: 'q_pregnant_or_recent_birth',
  child_order: 'q_child_order',
  second_child_girl: 'q_second_child_girl',
  has_category_proof: 'q_has_category_proof',
};

export const CATEGORY_TEXT: Record<(typeof PMMVY_CATEGORIES)[number], DictKey> = {
  sc_st: 'cat_sc_st',
  disability: 'cat_disability',
  bpl_ration: 'cat_bpl_ration',
  pmjay: 'cat_pmjay',
  eshram: 'cat_eshram',
  pm_kisan: 'cat_pm_kisan',
  mgnrega: 'cat_mgnrega',
  income_below_8_lakh: 'cat_income_below_8_lakh',
  aww_awh_asha: 'cat_aww_awh_asha',
  nfsa_ration: 'cat_nfsa_ration',
};
