const categoryModel = require('../models/category').CategoryModel;
const post = require('../models/post').PostModel;
const shortid = require('shortid');
const tool = require('../utility/tool');
const redisClient = require('../utility/redisClient');
const i18n = require('../models/i18n')

//列表栏目默认增加全部分类
let cateAll = {
	"_id": "",
	"Alias": "",
	"CateName": i18n.__("Category.all"),
	"Img": "/images/All.svg"
};
//列表栏目默认增加未分类
let cateOther = {
	"_id": "other",
	"Alias": "other",
	"CateName": i18n.__("Category.uncate"),
	"Img": "/images/other.svg"
};

/**
 * 获取分类数据
 * @param [isAll] 是否包含全部分类和未分类
 * @param [cached] 是否读取缓存
 * @param callback 回调函数
 */
exports.getAll = function (isAll, cached, callback) {
	if (typeof cached === 'function') {
		callback = cached;
		cached = true;
	} else if (typeof isAll === 'function') {
		callback = isAll;
		isAll = true;
		cached = true;
	}
	//缓存的key名称
	let cache_key = isAll ? 'categories_all' : 'categories';
	if (cached) {
		//尝试读取缓存
		redisClient.getItem(cache_key, function (err, categories) {
			//读取缓存出错
			if (err) {
				return callback(err);
			}
			//缓存中有数据
			if (categories) {
				return callback(null, categories);
			}
			//缓存中没有数据，则从数据库中读取
			categoryModel.find(function (err, categories) {
				//读取数据库出错
				if (err) {
					return callback(err);
				}
				if (isAll) {
					categories.unshift(cateAll);
					categories.push(cateOther);
				}
				//从数据库中读到数据
				if (categories) {
					//将数据塞入缓存
					redisClient.setItem(cache_key, categories, redisClient.defaultExpired, function (err) {
						if (err) {
							return callback(err);
						}
					})
				}
				return callback(null, categories);
			});
		});
	} else {
		categoryModel.find(function (err, categories) {
			if (err) {
				return callback(err);
			}
			if (isAll) {
				categories.unshift(cateAll);
				categories.push(cateOther);
			}
			return callback(null, categories);
		});
	}
};

/**
 * 根据分类alias获取分类
 * @param alias 分类alias
 * @param callback 回调函数
 * @returns {*}
 */
exports.getByAlias = function (alias, callback) {
	let cache_key = 'category_' + alias;
	if (alias) {
		if (alias === 'other') {
			return callback(null, cateOther);
		} else {
			redisClient.getItem(cache_key, function (err, category) {
				if (err) {
					return callback(err);
				}
				if (category) {
					return callback(null, category);
				}
				categoryModel.findOne({
					"Alias": alias
				}, function (err, category) {
					if (err) {
						return callback(err);
					}
					if (category) {
						redisClient.setItem(cache_key, category, redisClient.defaultExpired, function (err) {
							if (err) {
								return callback(err);
							}
						})
					}
					return callback(null, category);
				});
			});
		}
	} else {
		return callback(null, cateAll);
	}
};

/**
 * 保存分类数据
 * @param array 分类集合
 * @param callback 回调函数
 */
exports.save = function (array, callback) {
	let jsonArray = [],
		toUpdate = [],
		updateQuery = [],
		cateNew;
	if (array.length > 0) {
		array.forEach(function (item) {
			jsonArray.push({
				_id: item.uniqueid || shortid.generate(),
				CateName: item.catename,
				Alias: item.alias,
				Img: item.img,
				Link: item.link,
				CreateTime: new Date(),
				ModifyTime: new Date()
			});
		});
	}
	categoryModel.find(function (err, categories) {
		if (err) {
			return callback(err);
		}
		categories.forEach(function (old) {
			cateNew = tool.jsonQuery(jsonArray, {
				"_id": old._id
			});
			if (!cateNew) {
				//该分类将被删除
				toUpdate.push(old._id);
			} else {
				//该分类依然存在，则创建时间沿用原创建时间
				cateNew.CreateTime = old.CreateTime;
				//若该分类未做任何修改，则修改时间沿用原修改时间
				if (cateNew.CateName.toString() === old.CateName.toString() && cateNew.Alias.toString() === old.Alias.toString() && cateNew.Img === old.Img && cateNew.Link === old.Link) {
					cateNew.ModifyTime = old.ModifyTime;
				}
			}
		});

		//将已被删除分类的文章设为"未分类"
		if (toUpdate.length > 0) {
			toUpdate.forEach(function (cateId) {
				updateQuery.push({
					"CategoryId": cateId
				});
			});
			post.update({
				"$or": updateQuery
			}, {
				"CategoryId": "other"
			}, {
				multi: true
			}, function (err) {
				if (err) {
					return callback(err);
				}
			});
		}

		//将分类全部删除
		categoryModel.remove(function (err) {
			if (err) {
				return callback(err);
			}
			if (jsonArray.length > 0) {
				//插入全部分类
				//categoryModel.create(jsonArray, function (err) {}); //不用这个，因为这个内部实现依然是循环插入，不是真正的批量插入
				//这里采用mongodb原生的insert来批量插入多个文档
				categoryModel.collection.insert(jsonArray, function (err) {
					if (err) {
						return callback(err);
					}
					return callback(null);
				});
			} else {
				return callback(null);
			}
		});
	});
};