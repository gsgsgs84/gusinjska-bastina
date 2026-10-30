import cv2, numpy as np, sys
det = cv2.QRCodeDetector(); aru = cv2.QRCodeDetectorAruco()
for f in sys.argv[1:]:
    img = cv2.imread(f); h, w = img.shape[:2]; res = []
    for W in [1400, 800, 500, 340]:
        s = cv2.resize(img, (W, int(h * W / w)), interpolation=cv2.INTER_AREA)
        for blur in (0, 3):
            t = cv2.GaussianBlur(s, (blur, blur), 0) if blur else s
            res.append('OK' if (det.detectAndDecode(t)[0] or aru.detectAndDecode(t)[0]) else '--')
    src = np.float32([[0,0],[w,0],[w,h],[0,h]]); dst = np.float32([[w*.08,h*.05],[w*.95,0],[w,h],[0,h*.93]])
    t = cv2.resize(cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(200,200,200)), (700, int(700*h/w)))
    url = det.detectAndDecode(t)[0] or aru.detectAndDecode(t)[0]
    print(f.split('/')[-1], ' '.join(res), '| tilt:', url or 'FAIL')
