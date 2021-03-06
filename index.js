import express from 'express';
import pg from 'pg';
import methodOverride from 'method-override';
import cookieParser from 'cookie-parser';
import { getHash } from './helper.js';

const app = express();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));
app.use(express.static('public'));
app.use(cookieParser());

const { Pool } = pg;

let pgConnectionConfigs;

if (process.env.DATABASE_URL) {
  pgConnectionConfigs = {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  };
} else {
  pgConnectionConfigs = {
    user: 'kimmilee',
    host: 'localhost',
    database: 'makecents',
    port: 5432,
  };
}

const pool = new Pool(pgConnectionConfigs);

const PORT = process.env.PORT || 3004;

// ==================== MIDDLEWARE ====================

const checkAuth = (req, res, next) => {
  req.isLoggedIn = false;
  if (req.cookies.loggedIn && req.cookies.userId) {
    const { loggedIn, userId } = req.cookies;
    const hashedCookie = getHash(userId);

    if (hashedCookie === loggedIn) {
      req.isLoggedIn = true;
    }
  }
  next();
};

// ==================== LOGIN & SIGNUPS ====================

app.get('/', checkAuth, (req, res) => {
  if (req.isLoggedIn === true) {
    res.redirect('/dashboard');
    return;
  }
  const { signup } = req.query;
  res.render('home', { signup });
});

app.post('/signup', (req, res) => {
  pool
    .query('SELECT * FROM users WHERE username=$1', [req.body.username])
    .then((result) => {
      if (result.rows.length > 0) {
        res.redirect('/?signup=fail');
        return;
      }
      const hashedPw = getHash(req.body.password);
      const values = [req.body.username, hashedPw];
      pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', values, () => {
        res.redirect('/dashboard');
      });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

app.get('/login', checkAuth, (req, res) => {
  if (req.isLoggedIn === true) {
    res.redirect('/dashboard');
    return;
  }
  const { login } = req.query;
  res.render('login', { login });
});

app.post('/login', (req, res) => {
  const values = [req.body.username];
  pool
    .query('SELECT * FROM users WHERE username=$1', values)
    .then((result) => {
      if (result.rows.length === 0) {
        res.status(403).redirect('/login?login=fail');
        return;
      }

      const user = result.rows[0];

      const hashedPassword = getHash(req.body.password);

      if (user.password !== hashedPassword) {
        res.status(403).redirect('/login?login=fail');
        return;
      }

      const hashedCookieString = getHash(user.id);

      res.cookie('loggedIn', hashedCookieString);
      res.cookie('userId', user.id);
      res.redirect('/dashboard');
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

app.delete('/logout', (req, res) => {
  res.clearCookie('userId');
  res.clearCookie('loggedIn');
  res.redirect('login');
});

// ==================== DASHBOARD ====================

app.get('/dashboard', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
    return;
  }
  req.body.newTrxnId = null;
  if (req.query.from) {
    req.body.newTrxnId = req.query.from;
  }
  pool
    .query('SELECT exp_amount AS amt, categories.category AS cat FROM expenses LEFT JOIN categories ON expenses.exp_category = categories.id WHERE exp_user=$1 AND EXTRACT(month FROM exp_date) = EXTRACT(month FROM NOW()) AND expenses.exp_is_deleted=false', [req.cookies.userId])
    .then((result) => {
      const amtArray = result.rows.map(({ amt }) => amt);
      const dataObj = {};
      result.rows.forEach((trxn) => {
        if (trxn.cat in dataObj) {
          dataObj[trxn.cat] += Number(trxn.amt);
        } else {
          dataObj[trxn.cat] = Number(trxn.amt);
        }
      });
      req.body.catArray = Object.keys(dataObj);
      req.body.amtPerCatArray = Object.values(dataObj);
      req.body.totalAmt = amtArray.reduce((prev, curr) => prev + curr, 0);
      return pool.query('SELECT categories.category, expenses.id, TO_CHAR(expenses.exp_date, \'YYYY-MM-DD\') AS date, expenses.exp_name, expenses.exp_amount FROM expenses LEFT JOIN categories ON expenses.exp_category = categories.id WHERE exp_user=$1 AND exp_is_deleted=$2 ORDER BY expenses.exp_date DESC', [req.cookies.userId, false]); })
    .then((result) => {
      result.rows.forEach((item) => {
        item.exp_amount = `$${item.exp_amount.toFixed(2)}`;
      });
      const {
        totalAmt, catArray, amtPerCatArray, newTrxnId,
      } = req.body;
      res.render('dashboard', {
        trxn: result.rows.slice(0, 5), totalAmt, catArray, amtPerCatArray, newTrxnId,
      });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

// ==================== ALL TRANSACTIONS ====================

app.get('/trxn', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
  }
  pool
    .query('SELECT categories.category, expenses.id, TO_CHAR(expenses.exp_date, \'YYYY-MM-DD\') AS date, expenses.exp_name, expenses.exp_amount FROM expenses LEFT JOIN categories ON expenses.exp_category = categories.id WHERE exp_user=$1 AND exp_is_deleted=$2 ORDER BY expenses.exp_date DESC', [req.cookies.userId, false])
    .then((result) => {
      result.rows.forEach((item) => {
        item.exp_amount = `$${item.exp_amount.toFixed(2)}`;
      });
      res.render('all-trxn', { trxn: result.rows });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

// ==================== SINGLE TRANSACTION ====================

app.get('/trxn/:trxnId', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
  }
  const { from } = req.query;
  const { trxnId } = req.params;
  pool
    .query('SELECT exp_user FROM expenses WHERE id=$1 AND exp_is_deleted=$2', [req.params.trxnId, false])
    .then((result) => {
      if (result.rows[0].exp_user.toString() !== req.cookies.userId) {
        // TODO: REDIRECT TO DASHBOARD AND ADD ERROR MSG
        res.status(403).send('sorry! wrong user');
      }
      return pool.query('SELECT categories.category, TO_CHAR(expenses.exp_date, \'YYYY-MM-DD\') AS date, expenses.exp_name, expenses.exp_amount FROM expenses LEFT JOIN categories ON expenses.exp_category = categories.id WHERE expenses.id=$1 AND exp_is_deleted=$2', [req.params.trxnId, false]);
    })
    .then((result) => {
      result.rows.forEach((item) => {
        item.exp_amount = `$${item.exp_amount.toFixed(2)}`;
      });
      res.render('trxn', { details: result.rows[0], from, trxnId });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

app.get('/trxn/:trxnId/edit', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
  }
  pool
    .query('SELECT exp_user FROM expenses WHERE id=$1 AND exp_is_deleted=$2', [req.params.trxnId, false])
    .then((result) => {
      if (result.rows[0].exp_user.toString() !== req.cookies.userId) {
        // TODO: REDIRECT TO DASHBOARD AND ADD ERROR MSG
        res.status(403).send('sorry! wrong user');
      }
      return pool.query('SELECT categories.category, TO_CHAR(expenses.exp_date, \'YYYY-MM-DD\') AS date, expenses.exp_name, expenses.exp_amount FROM expenses LEFT JOIN categories ON expenses.exp_category = categories.id WHERE expenses.id=$1 AND exp_is_deleted=$2', [req.params.trxnId, false]);
    })
    .then((result) => {
      req.body.details = result.rows[0];
      return pool.query('SELECT category FROM categories INNER JOIN users_categories ON categories.id=users_categories.uc_category WHERE users_categories.uc_user=$1', [req.cookies.userId]);
    })
    .then((result) => {
      const curCats = result.rows.map(({ category }) => category);
      const date = new Date();
      const curDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}}`;
      const { details } = req.body;
      res.render('edit', { categories: curCats, date: curDate, details });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

app.put('/trxn/:trxnId', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
  }
  const {
    category, date, name, amount,
  } = req.body;
  pool
    .query('SELECT id FROM categories WHERE category=$1', [category])
    .then((result) => pool.query('UPDATE expenses SET exp_category=$1, exp_date=$2, exp_name=$3, exp_amount=$4 WHERE id=$5', [result.rows[0].id, date, name, amount, req.params.trxnId]))
    .then(() => {
      res.redirect(`/trxn/${req.params.trxnId}?from=edit`);
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

app.delete('/trxn/:trxnId', (req, res) => {
  pool
    .query('UPDATE expenses SET exp_is_deleted=true WHERE id=$1', [req.params.trxnId])
    .then(() => {
      res.redirect('/dashboard?from=delete');
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

// ==================== NEW TRANSACTION ====================

app.get('/new', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
    return;
  }
  pool
    .query('SELECT category FROM categories INNER JOIN users_categories ON categories.id=users_categories.uc_category WHERE users_categories.uc_user=$1', [req.cookies.userId])
    .then((result) => {
      const curCats = result.rows.map(({ category }) => category);
      const date = new Date();
      const curDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}}`;
      res.render('new', { categories: curCats, date: curDate });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

app.post('/new', (req, res) => {
  const {
    category, date, name, amount,
  } = req.body;
  pool
    .query('SELECT id FROM categories WHERE category=$1', [category])
    .then((result) => (pool.query('INSERT INTO expenses (exp_user, exp_category, exp_date, exp_name, exp_amount) VALUES ($1, $2, $3, $4, $5) RETURNING id', [req.cookies.userId, result.rows[0].id, date, name, amount])))
    .then((result) => {
      const recordedId = result.rows[0].id;
      res.redirect(`/dashboard?from=${recordedId}`);
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

// ==================== WEEKLY/MONTHLY BREAKDOWN ====================

app.get('/breakdown', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
    return;
  }
  res.render('breakdown');
});

// ==================== PROFILE ====================

app.get('/profile', checkAuth, (req, res) => {
  if (req.isLoggedIn === false) {
    res.status(403).redirect('/');
    return;
  }
  if (req.query.from) {
    req.body.from = req.query.from;
  }
  pool
    .query('SELECT username FROM users WHERE id=$1', [req.cookies.userId])
    .then((result) => {
      req.body.user = result.rows[0].username;
      return pool.query('SELECT category FROM categories INNER JOIN users_categories ON categories.id=users_categories.uc_category WHERE users_categories.uc_user=$1', [req.cookies.userId]);
    })
    .then((result) => {
      const curCats = result.rows.map(({ category }) => category);
      const { user, from } = req.body;
      res.render('profile', { categories: curCats, user, from });
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error'); });
});

app.post('/profile', (req, res) => {
  const { category } = req.body;
  pool
    .query('INSERT INTO categories (category) VALUES ($1) RETURNING id', [category])
    .then((result) => (pool.query('INSERT INTO users_categories (uc_user, uc_category) VALUES ($1, $2)', [req.cookies.userId, result.rows[0].id])))
    .then(() => {
      res.redirect('/profile?from=newCat');
    })
    .catch((err) => {
      console.log('Error executing query', err.stack);
      res.status(503).send('error');
    });
});

// ================================================================================

app.listen(PORT);
