import { StyleSheet } from 'react-native';

export const PIP_W = 253;
export const PIP_H = 143;

const RED = '#f23b3f';
const SCREEN_BG = '#292222';
const PANEL_BG = '#383535';
const CAMERA_GREY = '#626261';

export const styles = StyleSheet.create({
  window: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  videoStreamContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: SCREEN_BG,
  },
  lidarStreamContainer: {
    backgroundColor: CAMERA_GREY,
  },
  videoPlaceholderText: {
    color: 'transparent',
    fontSize: 1,
    fontFamily: 'monospace',
  },
  lidarPlaceholderText: {
    color: 'transparent',
    fontSize: 1,
    fontFamily: 'monospace',
  },

  splitContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  splitHalf: {
    flex: 1,
  },
  splitHalfRight: {
    borderLeftWidth: 2,
    borderColor: RED,
  },

  pipWindow: {
    position: 'absolute',
    top: 80,
    left: 26,
    width: PIP_W,
    height: PIP_H,
    borderRadius: 0,
    borderWidth: 0,
    zIndex: 20,
    overflow: 'hidden',
    backgroundColor: CAMERA_GREY,
  },

  pipTouchable: {
    flex: 1,
  },
  pipSwapHint: {
    display: 'none',
  },
  pipSwapText: {
    color: RED,
    fontSize: 8,
    fontFamily: 'monospace',
  },

  dragPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    zIndex: 15,
  },
  dragPreviewHalf: {
    flex: 1,
    overflow: 'hidden',
  },
  dragPreviewActive: {
    opacity: 0.65,
    borderWidth: 2,
    borderColor: RED,
  },
  dragPreviewDim: {
    opacity: 0.25,
  },

  hudHeader: {
    position: 'absolute',
    top: 24,
    left: 22,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 50,
  },
  leftHudGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 30,
  },
  btnBack: {
    backgroundColor: '#000',
    height: 34,
    width: 86,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: RED,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnBackActive: {
    backgroundColor: RED,
  },
  btnFullScreen: {
    backgroundColor: '#000',
    height: 34,
    width: 70,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: RED,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnFullActive: {
    backgroundColor: RED,
  },
  btnText: {
    color: RED,
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 0,
  },
  btnTextActive: {
    color: '#161616',
  },

  telemetryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  telemetryText: {
    color: RED,
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 0,
  },
  lockButton: {
    width: 29,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: RED,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lockButtonActive: {
    backgroundColor: 'rgba(242, 59, 63, 0.12)',
  },

  rightHudGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  buildingsButton: {
    height: 34,
    minWidth: 132,
    paddingHorizontal: 18,
    backgroundColor: '#cfcfcf',
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buildingsButtonText: {
    color: '#171717',
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 0,
  },

  btnBurger: {
    width: 48,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  burgerLine: {
    width: 24,
    height: 2,
    backgroundColor: RED,
    marginVertical: 2,
  },
  switchContainer: {
    width: 48,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(20, 20, 20, 0.85)',
    borderWidth: 1,
    borderColor: '#333',
    padding: 2,
    justifyContent: 'center',
  },
  switchActive: {
    borderColor: RED,
  },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#444',
  },
  switchThumbActive: {
    backgroundColor: RED,
    alignSelf: 'flex-end',
  },

  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 38,
    paddingHorizontal: 40,
  },
  joystickArea: {
    width: 182,
    height: 182,
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickBase: {
    width: 182,
    height: 182,
    borderRadius: 91,
    backgroundColor: '#dddddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickStick: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#626262',
  },

  actionContainer: {
    flex: 1,
    height: 68,
    marginHorizontal: 24,
    justifyContent: 'center',
  },
  actionScroll: {
    backgroundColor: PANEL_BG,
    borderRadius: 8,
    width: 720,
    maxWidth: '100%',
    alignSelf: 'center',
  },
  actionScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 72,
    minWidth: 720,
  },
  actionButton: {
    height: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: 'transparent',
  },
  actionSeparator: {
    color: RED,
    fontSize: 18,
    fontFamily: 'monospace',
    marginRight: 28,
  },
  actionButtonText: {
    color: RED,
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 0,
  },

  pushMenu: {
    backgroundColor: SCREEN_BG,
    borderLeftWidth: 1,
    borderColor: '#433838',
    overflow: 'hidden',
  },
  menuInnerContent: {
    flex: 1,
    padding: 20,
  },
  menuCloseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },

  edificioCard: {
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#433838',
    borderRadius: 4,
    padding: 10,
  },
  edificioCardHeader: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  edificioThumb: {
    width: 72,
    height: 54,
    borderRadius: 3,
    backgroundColor: '#222',
    marginRight: 10,
  },
  edificioInfo: {
    flex: 1,
  },
  edificioName: {
    color: '#f6e7e7',
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  edificioBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  edificioBadgeText: {
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  edificioResumen: {
    color: '#8b7474',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },

  siguienteButton: {
    marginTop: 12,
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(242, 59, 63, 0.12)',
  },
  siguienteButtonText: {
    color: RED,
    fontSize: 14,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },

  sliderWrapper: {
    position: 'absolute',
    top: 246,
    left: 0,
    height: 52,
    justifyContent: 'center',
    zIndex: 100,
  },
  sliderWrapperSplit: {
    top: 130,
  },
  sliderBar: {
    height: 36,
    backgroundColor: '#000',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: RED,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
  },
  sliderBarActive: {
    backgroundColor: RED,
    borderColor: RED,
  },
  sliderText: {
    color: RED,
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 0,
  },
  sliderTextActive: {
    color: '#161616',
  },

  dpadArea: {
    width: 182,
    height: 182,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadBtn: {
    width: 58,
    height: 58,
    borderRadius: 6,
    backgroundColor: '#dddddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dpadMiddleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 4,
  },
  dpadCenter: {
    width: 58,
    height: 58,
    marginHorizontal: 4,
  },

  aiHudButton: {
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: RED,
    borderRadius: 4,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },

  aiModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  aiModal: {
    width: 440,
    maxHeight: 540,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: RED,
    backgroundColor: SCREEN_BG,
    padding: 18,
  },
  aiModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  aiModalTitle: {
    color: RED,
    fontSize: 18,
    fontFamily: 'monospace',
  },
  aiModalClose: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadArea: {
    height: 180,
    borderWidth: 1,
    borderColor: '#433838',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    overflow: 'hidden',
    backgroundColor: PANEL_BG,
  },
  uploadText: {
    color: '#8b7474',
    fontFamily: 'monospace',
    fontSize: 13,
    marginTop: 8,
  },
  previewImage: {
    width: '100%' as any,
    height: '100%' as any,
  },
  analyzeButton: {
    height: 40,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL_BG,
    marginBottom: 12,
  },
  analyzeButtonText: {
    color: RED,
    fontSize: 15,
    fontFamily: 'monospace',
  },
  resultsContainer: {
    marginTop: 4,
  },
  severityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  severityLabel: {
    color: '#f6e7e7',
    fontFamily: 'monospace',
    fontSize: 14,
  },
  severityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  severityValue: {
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 15,
  },
  gradeText: {
    color: '#8b7474',
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 10,
  },
  damagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  damageChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: RED,
    backgroundColor: 'rgba(242, 59, 63, 0.1)',
  },
  damageChipText: {
    color: RED,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  summaryText: {
    color: '#f6e7e7',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
});
