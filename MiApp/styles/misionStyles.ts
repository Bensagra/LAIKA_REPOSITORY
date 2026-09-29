import { StyleSheet } from 'react-native';
import { d } from '../utils/scale';
import { C, HELV, VIGA } from './theme';

// Mission screen (PDF pages 5, 6, 9, 10–12, 17, 18). Figma px on 844x390.
export const JOY_SIZE = d(131);
export const JOY_KNOB = d(55);

export const BAR_BUTTON = d(62);
export const BAR_GAP = d(5);
export const BAR_PAD = d(6);
const BAR_BOTTOM = d(25);
const BAR_HEIGHT = BAR_BUTTON + BAR_PAD * 2;
export const BAR_WIDTH = BAR_BUTTON * 6 + BAR_GAP * 5 + BAR_PAD * 2;

export const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: C.feedEmpty, overflow: 'hidden' },

  // Camera views
  stage: { ...StyleSheet.absoluteFillObject },
  stageLayer: { ...StyleSheet.absoluteFillObject },
  hidden: { display: 'none' },
  feed: { flex: 1, backgroundColor: C.feedEmpty, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  feedImage: { width: '100%', height: '100%' },
  feedEmptyText: {
    position: 'absolute',
    color: 'rgba(248,227,227,0.55)',
    fontFamily: HELV,
    fontWeight: '700',
    fontSize: d(12),
    letterSpacing: 1,
  },
  thermalReadout: {
    position: 'absolute',
    top: d(98),
    alignSelf: 'center',
    color: C.text,
    fontFamily: HELV,
    fontWeight: '700',
    fontSize: d(10),
    backgroundColor: 'rgba(35,30,30,0.7)',
    paddingHorizontal: d(8),
    paddingVertical: d(3),
    borderRadius: d(6),
  },

  // Top bar
  homeButton: {
    position: 'absolute',
    top: d(17),
    left: d(30),
    width: d(49),
    height: d(49),
    borderRadius: d(13),
    backgroundColor: C.panel,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  statusPill: {
    position: 'absolute',
    top: d(17),
    left: d(93),
    height: d(48),
    borderRadius: d(13),
    backgroundColor: C.panel,
    paddingHorizontal: d(16),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(7),
    zIndex: 10,
  },
  statusValue: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(13) },
  statusLabel: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(13) },
  statusDivider: { width: 1.5, height: d(22), backgroundColor: C.textFaint, marginHorizontal: d(6) },

  rightStack: { position: 'absolute', top: d(17), right: d(20), alignItems: 'flex-end', gap: d(8), zIndex: 10 },
  missionPill: {
    height: d(48),
    borderRadius: d(13),
    backgroundColor: C.panel,
    paddingHorizontal: d(20),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(14),
    maxWidth: d(260),
  },
  missionName: { color: C.textDim, fontFamily: HELV, fontWeight: '700', fontSize: d(12), flexShrink: 1 },
  missionTimer: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(15) },
  recPill: {
    height: d(30),
    borderRadius: d(15),
    borderWidth: 1.5,
    borderColor: C.red,
    backgroundColor: C.panel,
    paddingHorizontal: d(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(6),
  },
  recDot: { width: d(9), height: d(9), borderRadius: d(4.5), backgroundColor: C.red },
  recText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(12) },

  // Camera indicator (page 18 label + dots)
  feedChip: {
    position: 'absolute',
    top: d(24),
    alignSelf: 'center',
    minWidth: d(150),
    height: d(40),
    paddingHorizontal: d(20),
    borderRadius: d(11),
    backgroundColor: C.panel,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 11,
  },
  feedChipText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(15) },
  dotsArea: {
    position: 'absolute',
    top: d(71),
    alignSelf: 'center',
    paddingHorizontal: d(12),
    paddingVertical: d(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(5),
    zIndex: 10,
  },
  dot: { width: d(7), height: d(7), borderRadius: d(3.5), backgroundColor: '#D9D9D9' },
  dotActive: { width: d(24), backgroundColor: C.red },

  // Joysticks / arrows
  joyWrap: { position: 'absolute', bottom: d(26), zIndex: 10 },
  joyWrapLeft: { left: d(54) },
  joyWrapRight: { right: d(55) },
  joyColumn: { alignItems: 'center' },
  joyLabel: { color: C.textSoft, fontFamily: HELV, fontWeight: '700', fontSize: d(12), marginBottom: d(8) },
  joyBase: {
    width: JOY_SIZE,
    height: JOY_SIZE,
    borderRadius: JOY_SIZE / 2,
    backgroundColor: 'rgba(35,30,30,0.92)',
    borderWidth: 1,
    borderColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joyKnob: { width: JOY_KNOB, height: JOY_KNOB, borderRadius: JOY_KNOB / 2, backgroundColor: '#D9D9D9' },
  chevron: { position: 'absolute' },
  chevronTop: { top: d(8) },
  chevronBottom: { bottom: d(8) },
  chevronLeft: { left: d(8) },
  chevronRight: { right: d(8) },
  arrowButton: {
    position: 'absolute',
    width: d(40),
    height: d(40),
    borderRadius: d(12),
    backgroundColor: C.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowButtonPressed: { backgroundColor: C.red },
  arrowTop: { top: d(6) },
  arrowBottom: { bottom: d(6) },
  arrowLeft: { left: d(6) },
  arrowRight: { right: d(6) },

  // Action bar
  barArea: { position: 'absolute', bottom: BAR_BOTTOM, alignSelf: 'center', alignItems: 'center', zIndex: 10 },
  actionBar: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    padding: BAR_PAD,
    gap: BAR_GAP,
    borderRadius: d(20),
    backgroundColor: C.controlBar,
    flexDirection: 'row',
  },
  actionButton: {
    width: BAR_BUTTON,
    height: BAR_BUTTON,
    borderRadius: d(14),
    backgroundColor: C.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: d(4),
  },
  actionButtonActive: { backgroundColor: C.red },
  actionLabel: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(10.5) },

  // Status chips above the bar (page 17); x positions come from layoutChips().
  chipsRow: { width: BAR_WIDTH, height: d(17), marginBottom: d(8) },
  chip: {
    position: 'absolute',
    top: 0,
    height: d(17),
    paddingHorizontal: d(9),
    borderRadius: d(5),
    backgroundColor: C.red,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(9.5) },

  posturePopup: {
    flexDirection: 'row',
    gap: d(6),
    padding: d(6),
    marginBottom: d(8),
    borderRadius: d(16),
    backgroundColor: C.controlBar,
  },
  postureOption: {
    width: d(84),
    height: d(64),
    borderRadius: d(12),
    backgroundColor: C.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: d(4),
  },

  // Toast ("Foto guardada" / "Video guardado | 00:24")
  toast: {
    position: 'absolute',
    top: '50%',
    alignSelf: 'center',
    marginTop: d(-17),
    height: d(34),
    paddingHorizontal: d(14),
    borderRadius: d(8),
    backgroundColor: C.toast,
    flexDirection: 'row',
    alignItems: 'center',
    gap: d(8),
    zIndex: 30,
  },
  toastIcon: { width: d(18), height: d(18), borderRadius: d(9), backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  toastText: { color: '#2A2424', fontFamily: HELV, fontWeight: '700', fontSize: d(13) },

  // End mission modal (page 9)
  modalOverlay: { flex: 1, backgroundColor: 'rgba(40,34,34,0.6)', alignItems: 'center', justifyContent: 'center' },
  modalCard: { width: d(380), borderRadius: d(22), backgroundColor: C.panel, padding: d(26) },
  modalTitle: { color: C.text, fontFamily: VIGA, fontSize: d(22) },
  modalText: { color: C.textDim, fontFamily: HELV, fontSize: d(13), lineHeight: d(18), marginTop: d(10) },
  modalActions: { flexDirection: 'row', gap: d(14), marginTop: d(22) },
  modalSecondary: {
    width: d(136),
    height: d(51),
    borderRadius: d(13),
    backgroundColor: '#3D3434',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimary: {
    flex: 1,
    height: d(51),
    borderRadius: d(13),
    backgroundColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: { color: C.text, fontFamily: HELV, fontWeight: '700', fontSize: d(14) },
});
