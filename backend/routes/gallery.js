const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const upload  = require('../middleware/upload');
const ctrl    = require('../controllers/galleryController');

router.get('/',            ctrl.getAll);
router.post('/',           auth, upload.single('image'), ctrl.create);
router.patch('/reorder',   auth, ctrl.reorder);
router.patch('/:id',       auth, ctrl.update);
router.post('/:id/image',  auth, upload.single('image'), ctrl.swapImage);
router.delete('/:id',      auth, ctrl.remove);

module.exports = router;
